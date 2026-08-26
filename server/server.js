const express = require("express");
const path = require("path");

const { init } = require("./db");
const { TIERS } = require("./config/tiers");
const { uploadsDir } = require("./uploads");
const ordersRouter = require("./routes/orders");
const couriersRouter = require("./routes/couriers");
const { router: authRouter } = require("./routes/auth");
const { router: adminAuthRouter } = require("./routes/adminAuth");
const testimonialsRouter = require("./routes/testimonials");
const walletRouter = require("./routes/wallet");

init();

const app = express();
app.disable("x-powered-by");
app.use(express.json());

// Shared pricing config — the booking page fetches this instead of
// hardcoding tier numbers a second time on the client.
app.get("/api/tiers", (req, res) => {
  res.json({
    tiers: Object.entries(TIERS).map(([key, tier]) => ({ key, ...tier })),
  });
});

app.use("/api/orders", ordersRouter);
app.use("/api/couriers", couriersRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/auth", authRouter);
app.use("/api/admin/auth", adminAuthRouter);
app.use("/api/testimonials", testimonialsRouter);

// Uploaded delivery-proof photos/videos. Unauthenticated — filenames are
// hard to guess (order id + timestamp) but this is not real access control.
// The admin/courier pages that reference these URLs are now behind login;
// the files themselves aren't (fine for a prototype, worth revisiting).
app.use("/uploads", express.static(uploadsDir));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  next();
});

// The marketing site + booking/tracking/admin pages are static files served
// straight out of ../website — one process, one deploy.
const websiteDir = path.join(__dirname, "..", "website");
app.use(express.static(websiteDir));

// Anything else (API 404s are already handled above and never reach here).
app.use((req, res) => {
  res.status(404).sendFile(path.join(websiteDir, "index.html"));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Loyal Delivery Movers server listening on http://localhost:${PORT}`);
});
