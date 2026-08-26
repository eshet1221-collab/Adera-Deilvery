const express = require("express");
const { db } = require("../db");
const { TIERS, priceFor, COMMISSION_RATE } = require("../config/tiers");
const { generateTrackingCode, generateOtp } = require("../utils");
const { upload } = require("../uploads");
const { toFtsQuery, parsePagination } = require("../search");
const { sendOtpSms, isConfigured: smsConfigured } = require("../sms");
const { requireAuth, optionalAuth } = require("./auth");

const router = express.Router();

const STATUSES = ["pending", "matched", "picked_up", "delivered", "cancelled"];
const PAYMENT_METHODS = ["prepaid", "cod"];

// Mirrors the chain-of-custody flow in the plan: photo/video proof must be
// submitted, and the correct OTP entered, before picked_up -> delivered is
// allowed — the same two-gate idea as "payout doesn't release without OTP",
// with the photo/video step now enforced as its own precondition.
const NEXT_STATUS = {
  pending: ["matched", "cancelled"],
  matched: ["picked_up", "cancelled"],
  picked_up: ["delivered", "cancelled"],
  delivered: [],
  cancelled: [],
};

const REQUIRED_FIELDS = [
  "senderName",
  "senderPhone",
  "recipientName",
  "recipientPhone",
  "pickupAddress",
  "dropoffAddress",
];

function toOrderResponse(row, { includeOtp = false } = {}) {
  return {
    id: row.id,
    trackingCode: row.tracking_code,
    tier: row.tier,
    itemDescription: row.item_description,
    distanceKm: row.distance_km,
    priceBirr: row.price_birr,
    senderName: row.sender_name,
    senderPhone: row.sender_phone,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    pickupAddress: row.pickup_address,
    dropoffAddress: row.dropoff_address,
    status: row.status,
    courierId: row.courier_id,
    courierName: row.courier_name ?? undefined,
    proofSubmitted: Boolean(row.proof_file_path),
    proofUrl: row.proof_file_path ? `/uploads/${row.proof_file_path}` : null,
    proofSubmittedAt: row.proof_submitted_at,
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference,
    commissionBirr: row.commission_birr,
    courierPayoutBirr: row.courier_payout_birr,
    cashConfirmedAt: row.cash_confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(includeOtp ? { otpCode: row.otp_code } : {}),
  };
}

function fetchOrderWithCourier(id) {
  return db
    .prepare(
      `SELECT orders.*, couriers.full_name AS courier_name
       FROM orders
       LEFT JOIN couriers ON couriers.id = orders.courier_id
       WHERE orders.id = ?`
    )
    .get(id);
}

// Only bites when the request actually carried a courier's own session
// token (see optionalAuth) — the unauthenticated admin/call-center tools
// keep working exactly as before, since req.courier is never set for them.
function assertOwnership(req, res, row) {
  if (req.courier && row.courier_id !== req.courier.id) {
    res.status(403).json({ error: "This order isn't assigned to you" });
    return false;
  }
  return true;
}

function generateUniqueTrackingCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateTrackingCode();
    const exists = db.prepare("SELECT 1 FROM orders WHERE tracking_code = ?").get(code);
    if (!exists) return code;
  }
  throw new Error("Could not generate a unique tracking code after 10 attempts");
}

// POST /api/orders — create a new order. Price is computed server-side from
// config/tiers.js, never trusted from the client.
router.post("/", async (req, res) => {
  const body = req.body || {};
  const { tier, itemDescription, paymentMethod } = body;
  const distanceKm = Number(body.distanceKm);

  if (!TIERS[tier]) {
    return res.status(400).json({ error: `Unknown tier "${tier}". Valid tiers: ${Object.keys(TIERS).join(", ")}` });
  }
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 500) {
    return res.status(400).json({ error: "distanceKm must be a positive number (up to 500)" });
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return res
      .status(400)
      .json({ error: `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}` });
  }
  for (const field of REQUIRED_FIELDS) {
    const value = body[field];
    if (!value || !String(value).trim()) {
      return res.status(400).json({ error: `${field} is required` });
    }
  }

  const price = priceFor(tier, distanceKm);
  const trackingCode = generateUniqueTrackingCode();
  const otp = generateOtp();

  const insert = db.prepare(`
    INSERT INTO orders (
      tracking_code, otp_code, tier, item_description, distance_km, price_birr,
      sender_name, sender_phone, recipient_name, recipient_phone,
      pickup_address, dropoff_address, payment_method
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const info = insert.run(
    trackingCode,
    otp,
    tier,
    itemDescription ? String(itemDescription).trim() : null,
    distanceKm,
    price,
    String(body.senderName).trim(),
    String(body.senderPhone).trim(),
    String(body.recipientName).trim(),
    String(body.recipientPhone).trim(),
    String(body.pickupAddress).trim(),
    String(body.dropoffAddress).trim(),
    paymentMethod
  );

  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(info.lastInsertRowid);

  // The recipient is who hands the OTP to the courier at delivery (see the
  // picked_up -> delivered gate below), so they're who gets texted.
  await sendOtpSms(row.recipient_phone, otp);

  // otpCode is only handed back over the API when SMS isn't configured — a
  // local-dev fallback so this still works with no SMS account set up.
  // Once a real gateway is wired up (SMS_API_URL/SMS_API_KEY set), the code
  // is texted instead and stops being exposed here. Later lookups
  // (GET /track/:code) never include it either way.
  res.status(201).json({ order: toOrderResponse(row, { includeOtp: !smsConfigured() }) });
});

// GET /api/orders — admin listing: full-text search (?q=), status/tier
// filters, and pagination — so this stays usable however many rows are in
// the table. Search hits orders_fts (an FTS5 inverted index over tracking
// code, sender/recipient name+phone, and both addresses), not a LIKE scan.
router.get("/", (req, res) => {
  const { page, pageSize, limit, offset } = parsePagination(req.query);
  const ftsQuery = req.query.q ? toFtsQuery(req.query.q) : null;

  const conditions = [];
  const params = [];

  if (ftsQuery) {
    conditions.push("orders_fts MATCH ?");
    params.push(ftsQuery);
  }
  if (req.query.status && STATUSES.includes(req.query.status)) {
    conditions.push("orders.status = ?");
    params.push(req.query.status);
  }
  if (req.query.tier && TIERS[req.query.tier]) {
    conditions.push("orders.tier = ?");
    params.push(req.query.tier);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const fromSql = ftsQuery
    ? "orders_fts JOIN orders ON orders.id = orders_fts.rowid LEFT JOIN couriers ON couriers.id = orders.courier_id"
    : "orders LEFT JOIN couriers ON couriers.id = orders.courier_id";

  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${fromSql} ${whereSql}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT orders.*, couriers.full_name AS courier_name
       FROM ${fromSql}
       ${whereSql}
       ORDER BY orders.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({
    // includeOtp: this is the admin/call-center listing (no login, internal
    // tooling only) — staff need to be able to read out the delivery code
    // over the phone if a recipient says they never got the SMS. Never
    // exposed on GET /mine (couriers must get it verbally from the
    // recipient, not read it off their own screen) or GET /track/:code
    // (public).
    orders: rows.map((row) => toOrderResponse(row, { includeOtp: true })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

// GET /api/orders/mine — a logged-in courier's own assigned orders (the
// "My Deliveries" page). Unlike GET /, this is intentionally unpaginated —
// one courier's own workload is naturally small, unlike the full admin
// listing this app is built to scale past.
router.get("/mine", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT orders.*, couriers.full_name AS courier_name
       FROM orders
       LEFT JOIN couriers ON couriers.id = orders.courier_id
       WHERE orders.courier_id = ?
       ORDER BY orders.updated_at DESC`
    )
    .all(req.courier.id);
  res.json({ orders: rows.map((row) => toOrderResponse(row)) });
});

// GET /api/orders/track/:code — public lookup, no auth, no OTP in the response.
router.get("/track/:code", (req, res) => {
  const code = String(req.params.code).trim().toUpperCase();
  const row = db
    .prepare(
      `SELECT orders.*, couriers.full_name AS courier_name
       FROM orders
       LEFT JOIN couriers ON couriers.id = orders.courier_id
       WHERE orders.tracking_code = ?`
    )
    .get(code);
  if (!row) return res.status(404).json({ error: "No order found for that tracking code" });
  res.json({ order: toOrderResponse(row) });
});

// POST /api/orders/:id/proof — upload the photo/video chain-of-custody proof.
// Only allowed while an order is picked_up (courier has the item, hasn't
// handed it off yet) — mirrors "before giving the item to the receiver".
// optionalAuth: the admin tool calls this with no token at all (unchanged
// behavior); the courier-facing "My Deliveries" page calls it with its own
// session token, which is then required to match the order's courier_id.
router.post("/:id/proof", optionalAuth, (req, res) => {
  // Ownership is checked before the upload runs, not after — no reason to
  // let a courier's token write a file to disk for an order that isn't
  // theirs just to reject it a moment later.
  const preCheckRow = db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(req.params.id));
  if (!preCheckRow) return res.status(404).json({ error: "Order not found" });
  if (!assertOwnership(req, res, preCheckRow)) return;

  upload.single("proof")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const id = Number(req.params.id);
    const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
    if (!row) return res.status(404).json({ error: "Order not found" });
    if (row.status !== "picked_up") {
      return res
        .status(409)
        .json({ error: `Proof can only be submitted while an order is "picked_up" (currently "${row.status}")` });
    }
    if (!req.file) return res.status(400).json({ error: "No file uploaded (expected form field \"proof\")" });

    db.prepare(
      `UPDATE orders SET proof_file_path = ?, proof_submitted_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    ).run(req.file.filename, id);

    res.status(201).json({ order: toOrderResponse(fetchOrderWithCourier(id)) });
  });
});

// POST /api/orders/:id/confirm-cash — the courier explicitly confirms
// they've collected the cash/digital payment from the recipient on a COD
// order. Required (like proof) before the delivered transition is allowed —
// see the "delivered" branch of PATCH /:id/status below — so a courier can't
// mark a COD order delivered, and trigger their own commission debit,
// without acknowledging they were actually paid. Not applicable to prepaid
// orders (the sender already paid into escrow before matching).
router.post("/:id/confirm-cash", optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Order not found" });
  if (!assertOwnership(req, res, row)) return;

  if (row.payment_method !== "cod") {
    return res.status(409).json({ error: "Only Cash-on-Delivery orders need a cash confirmation" });
  }
  if (row.status !== "picked_up") {
    return res
      .status(409)
      .json({ error: `Cash can only be confirmed while an order is "picked_up" (currently "${row.status}")` });
  }

  db.prepare(
    `UPDATE orders SET cash_confirmed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).run(id);

  res.json({ order: toOrderResponse(fetchOrderWithCourier(id)) });
});

// POST /api/orders/:id/payment-reference — sender submits the external
// payment reference (Telebirr/CBE/Chapa transaction ID) after paying for a
// prepaid order outside the app — no live payment-gateway integration exists
// (same situation as SMS, see server/sms.js), so this mirrors the manual
// "enter the transaction ID" pattern the business plan itself describes for
// courier-registration payments. No auth: there is no sender session
// anywhere in this app, the same as order creation itself.
router.post("/:id/payment-reference", (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Order not found" });

  if (row.payment_method !== "prepaid") {
    return res.status(409).json({ error: "Only prepaid orders take a payment reference" });
  }
  if (row.payment_status !== "pending") {
    return res.status(409).json({ error: `Payment already ${row.payment_status} for this order` });
  }

  const reference = req.body?.paymentReference ? String(req.body.paymentReference).trim() : "";
  if (reference.length < 3 || reference.length > 100) {
    return res.status(400).json({ error: "paymentReference must be 3-100 characters" });
  }

  db.prepare(
    `UPDATE orders SET payment_status = 'escrowed', payment_reference = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(reference, id);

  res.json({ order: toOrderResponse(fetchOrderWithCourier(id)) });
});

// PATCH /api/orders/:id/status — advance the order through its lifecycle.
// matched   -> requires courierId
// delivered -> requires proof already submitted AND the correct otp
// optionalAuth: same deal as POST /:id/proof above — a courier's own token
// can only advance an order already assigned to them. Since row.courier_id
// is still null going into "matched", this also means a courier's token can
// never perform the initial match themselves — that stays an admin/call
// center action, not a self-claim.
router.patch("/:id/status", optionalAuth, (req, res) => {
  const id = Number(req.params.id);
  const { status, courierId, otp } = req.body || {};

  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Order not found" });
  if (!assertOwnership(req, res, row)) return;

  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `Unknown status "${status}"` });
  }
  const allowed = NEXT_STATUS[row.status] || [];
  if (!allowed.includes(status)) {
    return res.status(409).json({ error: `Cannot move an order from "${row.status}" to "${status}"` });
  }

  let resolvedCourierId = row.courier_id;
  if (status === "matched") {
    if (!courierId) return res.status(400).json({ error: "courierId is required to match a courier" });
    const courier = db.prepare("SELECT * FROM couriers WHERE id = ?").get(courierId);
    if (!courier) return res.status(400).json({ error: "Unknown courierId" });

    if (courier.status === "suspended") {
      return res
        .status(409)
        .json({ error: "This courier's wallet is suspended — top up before matching new orders" });
    }
    if (row.payment_method === "prepaid" && row.payment_status !== "escrowed") {
      return res
        .status(409)
        .json({ error: "This order's payment hasn't been confirmed yet — submit a payment reference before matching a courier" });
    }
    if (row.payment_method === "cod") {
      const requiredBuffer = Math.round(row.price_birr * COMMISSION_RATE * 100) / 100;
      if (courier.wallet_balance_birr < requiredBuffer) {
        return res.status(409).json({
          error: `Courier's wallet balance (${courier.wallet_balance_birr} birr) is below the required minimum commission buffer (${requiredBuffer} birr) for this COD order`,
        });
      }
    }

    resolvedCourierId = courier.id;
  }

  if (status === "delivered") {
    if (!row.proof_file_path) {
      return res.status(400).json({ error: "Photo/video proof must be submitted before confirming delivery" });
    }
    if (row.payment_method === "cod" && !row.cash_confirmed_at) {
      return res
        .status(400)
        .json({ error: "The courier must confirm cash received before delivery can be confirmed" });
    }
    if (!otp || String(otp).trim() !== String(row.otp_code)) {
      return res.status(400).json({ error: "Incorrect OTP — delivery cannot be confirmed" });
    }

    // Fund Settlement Engine: flat commission split, applied the moment the
    // recipient's OTP confirms delivery. Prepaid escrow pays the courier
    // their 82% share; COD debits the courier's wallet for the 18% they owe
    // on cash they've already collected in person (and suspends them if that
    // debit takes their balance negative).
    const commission = Math.round(row.price_birr * COMMISSION_RATE * 100) / 100;
    const payout = Math.round((row.price_birr - commission) * 100) / 100;
    const courierForSettlement = db.prepare("SELECT * FROM couriers WHERE id = ?").get(resolvedCourierId);

    db.exec("BEGIN");
    try {
      if (row.payment_method === "prepaid") {
        const newBalance = Math.round((courierForSettlement.wallet_balance_birr + payout) * 100) / 100;
        db.prepare("UPDATE couriers SET wallet_balance_birr = ? WHERE id = ?").run(newBalance, resolvedCourierId);
        db.prepare(
          `INSERT INTO wallet_transactions (courier_id, order_id, type, amount_birr, balance_after_birr)
           VALUES (?, ?, 'delivery_payout', ?, ?)`
        ).run(resolvedCourierId, id, payout, newBalance);
      } else {
        const newBalance = Math.round((courierForSettlement.wallet_balance_birr - commission) * 100) / 100;
        db.prepare("UPDATE couriers SET wallet_balance_birr = ? WHERE id = ?").run(newBalance, resolvedCourierId);
        db.prepare(
          `INSERT INTO wallet_transactions (courier_id, order_id, type, amount_birr, balance_after_birr)
           VALUES (?, ?, 'commission_debit', ?, ?)`
        ).run(resolvedCourierId, id, -commission, newBalance);
        if (newBalance < 0) {
          db.prepare("UPDATE couriers SET status = 'suspended' WHERE id = ?").run(resolvedCourierId);
        }
      }

      db.prepare(
        `UPDATE orders SET status = ?, courier_id = ?, payment_status = 'settled',
          commission_birr = ?, courier_payout_birr = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(status, resolvedCourierId, commission, payout, id);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    return res.json({ order: toOrderResponse(fetchOrderWithCourier(id)) });
  }

  db.prepare(
    `UPDATE orders SET status = ?, courier_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(status, resolvedCourierId, id);

  res.json({ order: toOrderResponse(fetchOrderWithCourier(id)) });
});

module.exports = router;
