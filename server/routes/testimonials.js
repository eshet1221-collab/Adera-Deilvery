const express = require("express");
const { db } = require("../db");

const router = express.Router();

const VALID_ROLES = new Set(["sender", "receiver", "courier"]);

function toTestimonialResponse(row) {
  return {
    id: row.id,
    authorName: row.author_name,
    role: row.role,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

// GET /api/testimonials — public, most recent first.
router.get("/", (req, res) => {
  const rows = db.prepare("SELECT * FROM testimonials ORDER BY created_at DESC").all();
  res.json({ testimonials: rows.map(toTestimonialResponse) });
});

// POST /api/testimonials — public submission, no auth. Senders and
// recipients never have accounts in this prototype, so gating this behind
// login would exclude two of the three roles it's meant for.
router.post("/", (req, res) => {
  const { authorName, role, rating, comment } = req.body || {};

  if (!authorName || !String(authorName).trim()) {
    return res.status(400).json({ error: "authorName is required" });
  }
  if (!VALID_ROLES.has(role)) {
    return res.status(400).json({ error: `role must be one of: ${[...VALID_ROLES].join(", ")}` });
  }
  if (!comment || !String(comment).trim()) {
    return res.status(400).json({ error: "comment is required" });
  }

  let ratingValue = null;
  if (rating !== undefined && rating !== null && rating !== "") {
    ratingValue = Number(rating);
    if (!Number.isInteger(ratingValue) || ratingValue < 1 || ratingValue > 5) {
      return res.status(400).json({ error: "rating must be an integer from 1 to 5" });
    }
  }

  const info = db
    .prepare("INSERT INTO testimonials (author_name, role, rating, comment) VALUES (?, ?, ?, ?)")
    .run(String(authorName).trim(), role, ratingValue, String(comment).trim());

  const row = db.prepare("SELECT * FROM testimonials WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ testimonial: toTestimonialResponse(row) });
});

module.exports = router;
