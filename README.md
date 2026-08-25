# Loyal Delivery Movers

Code generated from the **Crowdsourced Urban Logistics Platform for Addis Ababa**
business proposal (`Project requirement.pdf`) — a 4-tier crowdsourced
delivery platform for Addis Ababa.

This repo has two parts:

| Folder | What it is | Requires |
|---|---|---|
| [`website/`](website/README.md) | The marketing/pitch page (`index.html`) — fully static, deploy anywhere including GitHub Pages | Nothing |
| [`server/`](server/README.md) | A working prototype API + SQLite database behind `order.html`, `track.html`, `admin.html`, `couriers.html`, `earnings.html`, `login.html`/`dashboard.html`/`deliveries.html`, `testimonials.html`, and `call-center.html` — real order creation, tracking, an OTP+photo-gated status workflow, courier "Members" login and self-service delivery management, public reviews, and a phone-in booking flow for people without internet access | Node.js 22.5+ |

## Quick start

```powershell
cd server
npm install
npm start
```

Open **http://localhost:3000** — this serves the entire site (marketing page
+ booking/tracking/admin) from one process. `website/index.html` also works
opened directly with no server at all; the booking/tracking/admin pages need
the server.

## What's real vs. what's illustrative

The business plan (`Project requirement.pdf`, Section 9) describes a full
production system: Flutter apps, NestJS microservices, PostgreSQL+PostGIS,
Fayda ID verification, Telebirr/Chapa escrow, live GPS, and a route-matching
algorithm. That's a multi-month build, not something to hand-code in one
sitting — so what's here is intentionally scoped:

- **Marketing content** (all of `index.html`): copy and figures pulled
  directly from the plan, for presenting the idea — not connected to
  anything.
- **Pricing math**: real, and shared between the client-side calculator and
  the server (`server/config/tiers.js`), computed from the plan's own
  base-fare + per-km formula.
- **Order creation, tracking, and the status workflow** (`server/`): real —
  backed by an actual SQLite database, with server-side validation. A
  `picked_up → delivered` transition requires **both** a photo/video proof
  upload and the correct OTP — neither gate can be skipped.
- **Courier registration**: real, including a Fayda ID field (format-checked
  only — not verified against any real national ID API), email, gender, a
  required photo, and a required photo of the physical Fayda ID card
  (uploaded files, image-only), plus a password that sets up **Members
  login**.
- **Admin: activate/deactivate couriers**: real — `admin.html`/`couriers.html`
  can flip a courier between `active`/`inactive`; inactive couriers stay in
  the roster but drop out of the "Match a courier" search.
- **Members login, split into two views**: real, and deliberately scoped —
  couriers log in (`login.html`) with a session token (Node's built-in
  `crypto.scrypt` for hashing, no bcrypt dependency) and see **only their
  own** delivery count, amount handled, and earnings after commission
  (`dashboard.html`, `GET /api/couriers/me/stats`). Seeing *every* courier's
  earnings — the full sortable leaderboard — is now an admin-only view
  (`earnings.html`, under the "Admin" nav dropdown, no login required, same
  as the rest of the admin tooling). This used to be one endpoint any
  logged-in courier could call to see everyone's numbers; splitting it was a
  real fix, not just a UI change.
- **"My Deliveries" (`deliveries.html`)**: real — a logged-in courier sees
  only the orders assigned to them (`GET /api/orders/mine`) and can mark
  picked-up, upload proof, and confirm delivery with the OTP, same gates as
  the admin tool. Their session token is now actually checked against the
  order's `courier_id` on every mutation (`POST /:id/proof`, `PATCH
  /:id/status`) — a courier can't touch an order that isn't theirs, verified
  by testing one courier's token against another's assigned order (403).
  The unauthenticated admin/call-center path these same endpoints also serve
  is untouched — no token means no ownership check, exactly as before.
- **Testimonials** (`testimonials.html`): real — public, unauthenticated
  submissions from senders, receivers, or couriers, stored and listed for
  real.
- **Admin search + pagination**: real — `admin.html` and `couriers.html`
  page through results and full-text search them (name, phone, tracking
  code, address — including matching a fragment in the *middle* of a
  phone number, not just from the start), backed by real SQLite FTS5
  search indexes rather than loading every row into the browser. Built
  specifically so these lists don't fall over once there are far more than
  a page's worth of orders or couriers.
- **OTP delivery by SMS**: pluggable but off by default — `server/sms.js`
  will text the recipient the delivery code once you configure an Ethiopian
  bulk-SMS gateway's API key (`server/.env.example`); with nothing
  configured, the OTP is still just handed back in the API response like
  before, so this doesn't require setup to keep working.
- **Call / Call Center**: real, for people without internet access —
  `call.html` is a public page with a phone number to call (a
  clearly-marked placeholder, `+251 900 000 000`, until a real line is set
  up); `call-center.html` is the internal tool an agent uses to take the
  call — same booking form and `POST /api/orders` as the public site, plus
  an inline "assign a courier" search right after the order is created, so
  the whole call can be handled without leaving the page. There's no live
  GPS or route-matching in this prototype (out of scope, see below), so
  "nearest courier" is a manual pick by the agent, same as the existing
  "Match a courier" flow on `admin.html` — not automatic.
- **Real Fayda ID/biometric verification, payments/escrow, live GPS, the
  route-matching algorithm, and production-grade auth** (password reset,
  rate limiting, CSRF, testimonial moderation): not implemented. See
  `server/README.md` for the full list of what's out of scope and why.

## A note on testing

`server/` has been run and exercised end-to-end against a real SQLite
database. Beyond the original order/courier/proof flow (a courier registered
with an invalid Fayda ID was rejected, then accepted with a valid one; an
order was matched → picked up → delivery correctly refused with no proof
uploaded yet → a real file uploaded via multipart POST and served back from
`/uploads/` → delivery succeeded only once both proof and the correct OTP
were present), the newest features were tested too: registration without a
password was rejected, login with the wrong password was rejected, a valid
login returned a working session token, the admin leaderboard endpoint
returned correctly-sorted results under all four sort orders
(recency/amount/earnings/count) with the earnings math verified by hand, and
testimonial submission was tested both
with and without a rating plus rejection of an invalid role and an
out-of-range rating. Search and pagination were tested against ~100 seeded
rows: substring phone-number search, combined search+filter, paginated
navigation with no overlap between pages, and edge cases (page 0, a page
past the end, an oversized page size). One genuine bug turned up and was
fixed during that testing — see `server/README.md` for what it was and how
it was caught. Courier registration's new fields were tested too: rejection
with a missing email/gender/photo/Fayda-ID-photo, rejection of a non-image
file upload, a full valid multipart registration with both files (confirmed
retrievable back from `/uploads/`), and the active/inactive status toggle —
including confirming a deactivated courier disappears from the "Match a
courier" search (which only searches active couriers) while still showing up
in the unfiltered roster. "My Deliveries" was tested end-to-end with two
separate courier accounts: courier A's own order correctly appeared in their
`/mine` list and courier B's did not; courier B's session token was rejected
(403) trying to advance or upload proof to courier A's order; courier A
could then mark it picked up, upload proof, get rejected with the wrong OTP,
and confirm delivery with the correct one. The existing unauthenticated
admin/call-center path through the same endpoints (create → match → pick up
→ proof → deliver, no token at all) was re-run afterward and confirmed
unchanged. The Members stats split was verified directly: `GET
/api/couriers/stats` with no token at all returned the full roster (52
couriers in the test database, admin view); `GET /api/couriers/me/stats`
with courier A's token returned a single object for courier A only, with no
token returned 401, and the earnings figure it reported matched the same
courier's row in the full admin list exactly. It originally used
`better-sqlite3`, which failed to
install here (no prebuilt binary for this Node version, and no Python/C++
toolchain to compile it from source) — it now runs on Node's built-in
`node:sqlite` instead, which needs nothing beyond Node itself. Still worth
clicking through the UI yourself (`order.html` → `admin.html` →
`couriers.html` → `login.html` → `dashboard.html` → `testimonials.html` →
`track.html`) since this testing was done directly against the API, not the
browser-side forms/dialogs.
