const express = require("express");
const { db } = require("../db");
const { hashPassword, verifyPassword, generateToken } = require("../auth");

const router = express.Router();
const SENDER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, same as couriers — a low-stakes account, not a confidential-data gate

function toSenderSummary(row) {
  return { id: row.id, fullName: row.full_name, phone: row.phone };
}

// Same Bearer-token -> session-row -> expiry-check -> load-row shape as the
// courier and admin auth middlewares, against sender_sessions/senders — a
// third, fully separate token space.
function requireSenderAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Not logged in" });

  const session = db.prepare("SELECT * FROM sender_sessions WHERE token = ?").get(token);
  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) db.prepare("DELETE FROM sender_sessions WHERE token = ?").run(token);
    return res.status(401).json({ error: "Session expired — please log in again" });
  }

  const sender = db.prepare("SELECT * FROM senders WHERE id = ?").get(session.sender_id);
  if (!sender) return res.status(401).json({ error: "Account not found" });

  req.sender = sender;
  next();
}

function issueSession(res, status, sender) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SENDER_SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sender_sessions (token, sender_id, expires_at) VALUES (?, ?, ?)").run(token, sender.id, expiresAt);
  res.status(status).json({ token, sender: toSenderSummary(sender) });
}

// POST /api/senders/auth/register — lightweight signup (no document/photo
// verification, unlike courier registration): full name, phone, password.
// Auto-logs-in on success, same convenience as most consumer signup flows.
router.post("/register", (req, res) => {
  const { fullName, phone, password } = req.body || {};
  if (!fullName || !String(fullName).trim()) {
    return res.status(400).json({ error: "fullName is required" });
  }
  if (!phone || !String(phone).trim()) {
    return res.status(400).json({ error: "phone is required" });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: "password must be at least 6 characters" });
  }

  const trimmedPhone = String(phone).trim();
  const existing = db.prepare("SELECT id FROM senders WHERE phone = ?").get(trimmedPhone);
  if (existing) {
    return res.status(409).json({ error: "An account with that phone number already exists — log in instead" });
  }

  const passwordHash = hashPassword(String(password));
  const info = db
    .prepare("INSERT INTO senders (full_name, phone, password_hash) VALUES (?, ?, ?)")
    .run(String(fullName).trim(), trimmedPhone, passwordHash);
  const sender = db.prepare("SELECT * FROM senders WHERE id = ?").get(info.lastInsertRowid);

  issueSession(res, 201, sender);
});

// POST /api/senders/auth/login — by phone + password (phone is unique here, unlike couriers).
router.post("/login", (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) {
    return res.status(400).json({ error: "phone and password are required" });
  }

  const sender = db.prepare("SELECT * FROM senders WHERE phone = ?").get(String(phone).trim());
  if (!sender || !verifyPassword(String(password), sender.password_hash)) {
    return res.status(401).json({ error: "Incorrect phone or password" });
  }

  issueSession(res, 200, sender);
});

// POST /api/senders/auth/logout — invalidate the current session token.
router.post("/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) db.prepare("DELETE FROM sender_sessions WHERE token = ?").run(token);
  res.json({ ok: true });
});

// GET /api/senders/auth/me — the logged-in sender's own profile.
router.get("/me", requireSenderAuth, (req, res) => {
  res.json({ sender: toSenderSummary(req.sender) });
});

module.exports = { router, requireSenderAuth };
