const express = require("express");
const { db } = require("../db");
const { verifyPassword, generateToken } = require("../auth");

const router = express.Router();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function toCourierSummary(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    faydaId: row.fayda_id,
    tierCapability: row.tier_capability.split(",").filter(Boolean),
    status: row.status,
  };
}

// Reads the session token from "Authorization: Bearer <token>", loads the
// courier it belongs to, and attaches it as req.courier. 401s on anything
// wrong rather than letting a route run with a half-authenticated request.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Not logged in" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return res.status(401).json({ error: "Session expired — please log in again" });
  }

  const courier = db.prepare("SELECT * FROM couriers WHERE id = ?").get(session.courier_id);
  if (!courier) return res.status(401).json({ error: "Account not found" });

  req.courier = courier;
  next();
}

// Same token lookup as requireAuth, but never 401s — an invalid, expired, or
// missing token just means the request proceeds as an anonymous/admin-tool
// caller (req.courier stays unset) instead of being rejected. Lets
// order-mutation routes stay usable by the unauthenticated admin pages
// exactly as before, while still telling a courier's own request apart from
// one when it does carry a valid session token (see routes/orders.js).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return next();

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return next();
  }

  const courier = db.prepare("SELECT * FROM couriers WHERE id = ?").get(session.courier_id);
  if (courier) req.courier = courier;
  next();
}

// POST /api/auth/login — courier ("member") login by phone + password.
router.post("/login", (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) {
    return res.status(400).json({ error: "phone and password are required" });
  }

  // Phone isn't enforced unique at the DB level (see routes/couriers.js), so
  // this grabs whichever matching account was created first — a known
  // limitation of this prototype, not a real multi-account login system.
  const courier = db.prepare("SELECT * FROM couriers WHERE phone = ?").get(String(phone).trim());
  if (!courier || !courier.password_hash || !verifyPassword(String(password), courier.password_hash)) {
    return res.status(401).json({ error: "Incorrect phone or password" });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO sessions (token, courier_id, expires_at) VALUES (?, ?, ?)").run(token, courier.id, expiresAt);

  res.json({ token, courier: toCourierSummary(courier) });
});

// POST /api/auth/logout — invalidate the current session token.
router.post("/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  res.json({ ok: true });
});

// GET /api/auth/me — the logged-in courier's own profile.
router.get("/me", requireAuth, (req, res) => {
  res.json({ courier: toCourierSummary(req.courier) });
});

module.exports = { router, requireAuth, optionalAuth };
