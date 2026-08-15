const crypto = require("crypto");

const SCRYPT_KEYLEN = 64;

// Node's built-in crypto — no bcrypt/argon2 dependency needed (learned that
// lesson with better-sqlite3: fewer native deps, fewer install surprises).
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(candidate, "hex");
  // timingSafeEqual throws on length mismatch rather than returning false —
  // guard first so a wrong-length stored hash can't crash the request.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = { hashPassword, verifyPassword, generateToken };
