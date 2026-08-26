const express = require("express");
const { db } = require("../db");
const { verifyPassword, generateToken } = require("../auth");
const { requireAuth: requireCourierAuth } = require("./auth");

const router = express.Router();
const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h — shorter than the courier's 7 days, this gates confidential data

function toAdminSummary(row) {
  return { id: row.id, username: row.username };
}

// Same Bearer-token -> session-row -> expiry-check -> load-row shape as
// routes/auth.js's requireAuth, but against admin_sessions/admins — a fully
// separate token space, so a courier's own token can never satisfy this.
function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Not logged in" });

  const session = db.prepare("SELECT * FROM admin_sessions WHERE token = ?").get(token);
  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
    return res.status(401).json({ error: "Session expired — please log in again" });
  }

  const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(session.admin_id);
  if (!admin) return res.status(401).json({ error: "Account not found" });

  req.admin = admin;
  next();
}

// Replaces the old optionalAuth on endpoints shared between the
// admin/call-center tools and a courier's own app (proof upload, cash
// confirmation, order status transitions). Tries an admin session first,
// then falls back to the exact same courier-session lookup requireAuth
// does — so both keep working exactly as before, but a request with
// neither credential is now rejected instead of silently proceeding
// unauthenticated.
function requireAdminOrCourierAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Not logged in" });

  const adminSession = db.prepare("SELECT * FROM admin_sessions WHERE token = ?").get(token);
  if (adminSession) {
    if (new Date(adminSession.expires_at) < new Date()) {
      db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
    } else {
      const admin = db.prepare("SELECT * FROM admins WHERE id = ?").get(adminSession.admin_id);
      if (admin) {
        req.admin = admin;
        return next();
      }
    }
  }

  return requireCourierAuth(req, res, next);
}

// POST /api/admin/auth/login — the one shared admin account, by username + password.
router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password are required" });
  }

  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(String(username).trim());
  if (!admin || !verifyPassword(String(password), admin.password_hash)) {
    return res.status(401).json({ error: "Incorrect username or password" });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString();
  db.prepare("INSERT INTO admin_sessions (token, admin_id, expires_at) VALUES (?, ?, ?)").run(token, admin.id, expiresAt);

  res.json({ token, admin: toAdminSummary(admin) });
});

// POST /api/admin/auth/logout — invalidate the current admin session token.
router.post("/logout", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token = ?").run(token);
  res.json({ ok: true });
});

// GET /api/admin/auth/me — the logged-in admin's own profile.
router.get("/me", requireAdminAuth, (req, res) => {
  res.json({ admin: toAdminSummary(req.admin) });
});

module.exports = { router, requireAdminAuth, requireAdminOrCourierAuth };
