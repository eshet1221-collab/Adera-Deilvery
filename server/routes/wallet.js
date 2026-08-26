const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("./auth");
const { requireAdminAuth } = require("./adminAuth");

const router = express.Router();

function toTransactionResponse(row) {
  return {
    id: row.id,
    type: row.type,
    amountBirr: row.amount_birr,
    balanceAfterBirr: row.balance_after_birr,
    reference: row.reference,
    orderId: row.order_id,
    orderTrackingCode: row.tracking_code ?? undefined,
    createdAt: row.created_at,
  };
}

function fetchTransactions(courierId) {
  return db
    .prepare(
      `SELECT wallet_transactions.*, orders.tracking_code
       FROM wallet_transactions
       LEFT JOIN orders ON orders.id = wallet_transactions.order_id
       WHERE wallet_transactions.courier_id = ?
       ORDER BY wallet_transactions.id DESC
       LIMIT 50`
    )
    .all(courierId);
}

// GET /api/wallet/me — the logged-in courier's own balance + recent history.
router.get("/me", requireAuth, (req, res) => {
  res.json({
    walletBalanceBirr: req.courier.wallet_balance_birr,
    status: req.courier.status,
    transactions: fetchTransactions(req.courier.id).map(toTransactionResponse),
  });
});

// POST /api/wallet/me/topup — manual top-up: the courier pays externally
// (Telebirr/CBE/etc, no live gateway integration — see server/sms.js for the
// same pattern applied to OTP delivery) and submits the transaction
// reference here. Credits the wallet immediately with no admin approval step
// — a deliberate simplification so the payment/COD flows stay testable
// end-to-end; a real deployment would likely gate this behind admin review
// the same way courier registration payments are described in the spec.
router.post("/me/topup", requireAuth, (req, res) => {
  const { amountBirr, reference } = req.body || {};
  const amount = Number(amountBirr);

  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return res.status(400).json({ error: "amountBirr must be a positive number (up to 1,000,000)" });
  }
  const ref = reference ? String(reference).trim() : "";
  if (ref.length < 3 || ref.length > 100) {
    return res.status(400).json({ error: "reference must be 3-100 characters" });
  }

  const newBalance = Math.round((req.courier.wallet_balance_birr + amount) * 100) / 100;
  const newStatus = req.courier.status === "suspended" && newBalance >= 0 ? "active" : req.courier.status;

  db.prepare("UPDATE couriers SET wallet_balance_birr = ?, status = ? WHERE id = ?").run(
    newBalance,
    newStatus,
    req.courier.id
  );
  const info = db
    .prepare(
      `INSERT INTO wallet_transactions (courier_id, type, amount_birr, balance_after_birr, reference)
       VALUES (?, 'topup', ?, ?, ?)`
    )
    .run(req.courier.id, amount, newBalance, ref);
  const transaction = db.prepare("SELECT * FROM wallet_transactions WHERE id = ?").get(info.lastInsertRowid);

  res.status(201).json({
    walletBalanceBirr: newBalance,
    status: newStatus,
    transaction: toTransactionResponse(transaction),
  });
});

// GET /api/wallet/:courierId — admin view of any courier's wallet.
router.get("/:courierId", requireAdminAuth, (req, res) => {
  const courier = db.prepare("SELECT * FROM couriers WHERE id = ?").get(Number(req.params.courierId));
  if (!courier) return res.status(404).json({ error: "Courier not found" });

  res.json({
    walletBalanceBirr: courier.wallet_balance_birr,
    status: courier.status,
    transactions: fetchTransactions(courier.id).map(toTransactionResponse),
  });
});

module.exports = router;
