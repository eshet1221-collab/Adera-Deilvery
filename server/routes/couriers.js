const express = require("express");
const { db } = require("../db");
const { hashPassword } = require("../auth");
const { requireAuth } = require("./auth");
const { requireAdminAuth } = require("./adminAuth");
const { toFtsQuery, parsePagination } = require("../search");
const { courierUpload } = require("../uploads");

const router = express.Router();

const VALID_TIERS = new Set(["express", "standard", "secure", "cargo"]);
const SORT_KEYS = new Set(["recent", "amount", "earnings", "count"]);
const VALID_GENDERS = new Set(["female", "male", "other", "prefer_not_to_say"]);
const VALID_STATUSES = new Set(["active", "inactive"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Real Fayda IDs are 12-digit FIN numbers, but this is a prototype field —
// only loosely validated (digits/spaces/dashes, 6-20 chars) so it doesn't
// block demo data, and never checked against the real Fayda ID API (out of
// scope — see README).
const FAYDA_ID_PATTERN = /^[\d\s-]{6,20}$/;

function toCourierResponse(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    gender: row.gender,
    faydaId: row.fayda_id,
    tierCapability: row.tier_capability.split(",").filter(Boolean),
    status: row.status,
    walletBalanceBirr: row.wallet_balance_birr,
    photoUrl: row.photo_path ? `/uploads/${row.photo_path}` : null,
    faydaIdPhotoUrl: row.fayda_id_photo_path ? `/uploads/${row.fayda_id_photo_path}` : null,
    createdAt: row.created_at,
  };
}

// GET /api/couriers — roster listing: full-text search (?q= — name, phone,
// Fayda ID), status filter, and pagination, most recently registered first.
// Search hits couriers_fts (an FTS5 inverted index), not a table scan, so
// this stays fast whether there are a dozen couriers or several million.
router.get("/", requireAdminAuth, (req, res) => {
  const { page, pageSize, limit, offset } = parsePagination(req.query);
  const ftsQuery = req.query.q ? toFtsQuery(req.query.q) : null;

  const conditions = [];
  const params = [];

  if (ftsQuery) {
    conditions.push("couriers_fts MATCH ?");
    params.push(ftsQuery);
  }
  if (req.query.status) {
    conditions.push("couriers.status = ?");
    params.push(req.query.status);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const fromSql = ftsQuery ? "couriers_fts JOIN couriers ON couriers.id = couriers_fts.rowid" : "couriers";

  const total = db.prepare(`SELECT COUNT(*) AS n FROM ${fromSql} ${whereSql}`).get(...params).n;
  const rows = db
    .prepare(
      `SELECT couriers.* FROM ${fromSql}
       ${whereSql}
       ORDER BY couriers.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({
    couriers: rows.map(toCourierResponse),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
});

// POST /api/couriers — register a courier. Stand-in for the real flow, which
// would verify the Fayda ID against the national biometric API before
// activation — here it's just captured and format-checked. The password sets
// up "Members" login (see routes/auth.js) — existing couriers registered
// before this field existed simply have no password and can't log in until
// re-registered.
//
// multipart/form-data (not JSON) because registration now also collects a
// headshot photo and a photo of the physical Fayda ID card, mirroring the
// same "no shortcuts on identity proof" gate the delivery-proof flow already
// enforces (see POST /api/orders/:id/proof).
router.post("/", (req, res) => {
  courierUpload.fields([
    { name: "photo", maxCount: 1 },
    { name: "faydaIdPhoto", maxCount: 1 },
  ])(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const { fullName, phone, email, gender, faydaId, password, tierCapability } = req.body || {};

    if (!fullName || !String(fullName).trim()) {
      return res.status(400).json({ error: "fullName is required" });
    }
    if (!phone || !String(phone).trim()) {
      return res.status(400).json({ error: "phone is required" });
    }
    if (!email || !EMAIL_PATTERN.test(String(email).trim())) {
      return res.status(400).json({ error: "a valid email is required" });
    }
    if (!gender || !VALID_GENDERS.has(String(gender))) {
      return res.status(400).json({ error: "gender is required" });
    }
    if (!faydaId || !String(faydaId).trim()) {
      return res.status(400).json({ error: "faydaId is required" });
    }
    if (!FAYDA_ID_PATTERN.test(String(faydaId).trim())) {
      return res.status(400).json({ error: "faydaId should be 6-20 digits (spaces/dashes allowed)" });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }
    const photoFile = req.files?.photo?.[0];
    const faydaIdPhotoFile = req.files?.faydaIdPhoto?.[0];
    if (!photoFile) {
      return res.status(400).json({ error: "a photo is required (form field \"photo\")" });
    }
    if (!faydaIdPhotoFile) {
      return res.status(400).json({ error: "a photo of the Fayda ID is required (form field \"faydaIdPhoto\")" });
    }

    let capabilities = Array.isArray(tierCapability)
      ? tierCapability.filter((t) => VALID_TIERS.has(t))
      : tierCapability && VALID_TIERS.has(tierCapability)
        ? [tierCapability]
        : [];
    if (!capabilities.length) capabilities = ["express", "standard"];

    const passwordHash = hashPassword(String(password));

    const info = db
      .prepare(
        `INSERT INTO couriers (full_name, phone, email, gender, fayda_id, password_hash, tier_capability, photo_path, fayda_id_photo_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        String(fullName).trim(),
        String(phone).trim(),
        String(email).trim(),
        String(gender),
        String(faydaId).trim(),
        passwordHash,
        capabilities.join(","),
        photoFile.filename,
        faydaIdPhotoFile.filename
      );

    const row = db.prepare("SELECT * FROM couriers WHERE id = ?").get(info.lastInsertRowid);
    res.status(201).json({ courier: toCourierResponse(row) });
  });
});

// PATCH /api/couriers/:id/status — admin toggles a courier active/inactive.
// Inactive couriers stay in the roster (history, past deliveries) but are
// meant to be excluded from courier-matching once that's enforced — today
// nothing stops matching an inactive courier, since matching is a manual
// admin pick, not automatic (see README, "route-matching" out of scope).
router.patch("/:id/status", requireAdminAuth, (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};

  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: `status must be one of: ${[...VALID_STATUSES].join(", ")}` });
  }

  const existing = db.prepare("SELECT * FROM couriers WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Courier not found" });

  // A suspended courier can only be cleared by topping up their wallet back
  // to >= 0 (see POST /api/wallet/me/topup) — this generic toggle must not
  // offer a bypass, even though "active" is otherwise a valid target status.
  if (existing.status === "suspended") {
    return res
      .status(409)
      .json({ error: "This courier is suspended for a negative wallet balance — they must top up to be reactivated, not an admin toggle" });
  }

  db.prepare("UPDATE couriers SET status = ? WHERE id = ?").run(status, id);
  const row = db.prepare("SELECT * FROM couriers WHERE id = ?").get(id);
  res.json({ courier: toCourierResponse(row) });
});

function computeStatsByCourier() {
  const deliveredOrders = db
    .prepare(
      `SELECT courier_id, price_birr, courier_payout_birr, updated_at FROM orders
       WHERE status = 'delivered' AND courier_id IS NOT NULL`
    )
    .all();

  const byCourier = new Map();
  for (const order of deliveredOrders) {
    if (!byCourier.has(order.courier_id)) {
      byCourier.set(order.courier_id, {
        deliveryCount: 0,
        totalAmountBirr: 0,
        totalEarningsBirr: 0,
        lastDeliveryAt: null,
      });
    }
    const entry = byCourier.get(order.courier_id);
    entry.deliveryCount += 1;
    entry.totalAmountBirr += order.price_birr;
    // courier_payout_birr is set at settlement time (see PATCH
    // /api/orders/:id/status) — for COD this is cash the courier already
    // physically holds (price minus commission), not a wallet credit; for
    // prepaid it's exactly what was credited to their wallet.
    entry.totalEarningsBirr += order.courier_payout_birr || 0;
    if (!entry.lastDeliveryAt || order.updated_at > entry.lastDeliveryAt) {
      entry.lastDeliveryAt = order.updated_at;
    }
  }
  return byCourier;
}

// GET /api/couriers/stats — ADMIN VIEW: every courier's delivery count,
// amount handled, and earnings (after commission), from completed
// (delivered) orders only. Requires the shared admin login (requireAdminAuth)
// — this used to require only a courier's own session token, which meant
// any courier could see every *other* courier's earnings; that gap is
// closed by keeping this admin-only, separate from a courier's own login
// (GET /me/stats below), which only ever shows their own numbers.
router.get("/stats", requireAdminAuth, (req, res) => {
  const sortKey = SORT_KEYS.has(req.query.sort) ? req.query.sort : "recent";
  const dir = req.query.dir === "asc" ? "asc" : "desc";
  const byCourier = computeStatsByCourier();

  // Include every registered courier, even ones with zero deliveries yet,
  // so the leaderboard reflects the whole roster, not just the active ones.
  const allCouriers = db.prepare("SELECT id, full_name, phone, status, wallet_balance_birr FROM couriers").all();
  const stats = allCouriers.map((c) => {
    const entry = byCourier.get(c.id) || {
      deliveryCount: 0,
      totalAmountBirr: 0,
      totalEarningsBirr: 0,
      lastDeliveryAt: null,
    };
    return {
      courierId: c.id,
      fullName: c.full_name,
      phone: c.phone,
      status: c.status,
      walletBalanceBirr: c.wallet_balance_birr,
      deliveryCount: entry.deliveryCount,
      totalAmountBirr: Math.round(entry.totalAmountBirr * 100) / 100,
      totalEarningsBirr: Math.round(entry.totalEarningsBirr * 100) / 100,
      lastDeliveryAt: entry.lastDeliveryAt,
    };
  });

  const comparators = {
    recent: (a, b) => (b.lastDeliveryAt || "").localeCompare(a.lastDeliveryAt || ""),
    amount: (a, b) => b.totalAmountBirr - a.totalAmountBirr,
    earnings: (a, b) => b.totalEarningsBirr - a.totalEarningsBirr,
    count: (a, b) => b.deliveryCount - a.deliveryCount,
  };
  stats.sort(comparators[sortKey]);
  if (dir === "asc") stats.reverse();

  res.json({ stats, sort: sortKey, dir });
});

// GET /api/couriers/me/stats — COURIER VIEW: the logged-in courier's own
// numbers only, never anyone else's. This is what "Members" (dashboard.html)
// shows after login.
router.get("/me/stats", requireAuth, (req, res) => {
  const byCourier = computeStatsByCourier();
  const entry = byCourier.get(req.courier.id) || {
    deliveryCount: 0,
    totalAmountBirr: 0,
    totalEarningsBirr: 0,
    lastDeliveryAt: null,
  };

  res.json({
    stats: {
      courierId: req.courier.id,
      fullName: req.courier.full_name,
      status: req.courier.status,
      walletBalanceBirr: req.courier.wallet_balance_birr,
      deliveryCount: entry.deliveryCount,
      totalAmountBirr: Math.round(entry.totalAmountBirr * 100) / 100,
      totalEarningsBirr: Math.round(entry.totalEarningsBirr * 100) / 100,
      lastDeliveryAt: entry.lastDeliveryAt,
    },
  });
});

module.exports = router;
