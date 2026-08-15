# Adera Delivery — Prototype API + Database

A small Express + SQLite backend that gives the marketing site real order
creation, tracking, and a courier/order workflow — backed by an actual
database, not mock data in the browser.

**What's real:**
- Orders are computed server-side (never trust the client's price) and
  persisted in SQLite.
- Tracking codes and OTP codes are generated per order.
- A status workflow (`pending → matched → picked_up → delivered`, or
  `cancelled` from any non-terminal state) is enforced server-side — you
  cannot skip a stage.
- The `picked_up → delivered` transition is now **gated on two things**:
  a photo/video proof file must already be uploaded (`POST
  /api/orders/:id/proof`), and the correct OTP must be supplied — mirroring
  the plan's "3-step photo verification" + "payout doesn't release without
  OTP" chain-of-custody logic (Section 7 / 9.10). Neither gate can be
  skipped; both are enforced server-side, not just hidden in the UI.
- Proof files are real uploads (`multer`, disk storage under
  `data/uploads/`, 25MB limit, image/video mimetype allow-list), served back
  at `/uploads/<filename>`.
- Couriers are registered with a **Fayda ID** field (format-checked —
  6-20 digits/spaces/dashes — but not verified against any real API), plus
  **email**, **gender**, a **photo**, and a **photo of the physical Fayda ID
  card** — all required, stored for real. Registration is `multipart/form-data`
  now (not JSON) because of the two image uploads, handled by a dedicated
  image-only `multer` instance (`courierUpload` in `uploads.js`, 10MB limit,
  jpg/png/webp/heic only — no video, unlike the delivery-proof upload).
- **Admin can activate/deactivate a courier** — `PATCH
  /api/couriers/:id/status` flips `active`/`inactive`. An inactive courier
  stays in the roster (history is preserved) but is excluded from the
  "Match a courier" search dialog on `admin.html`, since that search already
  filters to `status=active`.
- **Members login**: couriers set a password at registration and log in
  (phone + password) to a session-token-based "Members" area
  (`login.html` → `dashboard.html`). Passwords are hashed with Node's
  built-in `crypto.scrypt` (no bcrypt dependency needed) and sessions are
  random 32-byte tokens stored server-side in a `sessions` table with a
  7-day expiry, sent by the client as `Authorization: Bearer <token>`.
- **Members stats are split into two views**, because a courier being able
  to see every *other* courier's earnings was a real access-control gap:
  - `GET /api/couriers/stats` — the **admin** view (`earnings.html`, no
    login, same as the rest of the admin tooling): every courier's delivery
    count, amount handled, and earnings, sortable by recency/amount/earnings/count.
  - `GET /api/couriers/me/stats` — the **courier's own** view
    (`dashboard.html`, login required): the same numbers, computed the same
    way, but for `req.courier.id` only — there is no parameter or query
    string that gets a courier anyone else's numbers from this endpoint.
- **"My Deliveries"** (`deliveries.html`): a logged-in courier's own assigned
  orders (`GET /api/orders/mine`), with the same mark-picked-up /
  upload-proof / confirm-with-OTP actions as the admin tool. The order
  mutation routes (`POST /:id/proof`, `PATCH /:id/status`) now run an
  `optionalAuth` middleware (`routes/auth.js`) — if the request carries a
  courier's own session token, that courier must own the order
  (`order.courier_id === req.courier.id`) or it's rejected with 403; if the
  request carries no token at all (the admin/call-center tools, unchanged),
  no ownership check applies, same as before. A courier's token also can't
  perform the *initial* match — `courier_id` is still null going into that
  transition, so it never equals `req.courier.id`; matching stays an
  admin/call-center action.
- **Testimonials** (`testimonials.html`): public, unauthenticated
  submissions from senders, receivers, or couriers — real rows in a
  `testimonials` table, listed most-recent-first.
- **Admin search + pagination**, built to stay usable at large row counts:
  `GET /api/orders` and `GET /api/couriers` support full-text search
  (`?q=`), filters (`status`, `tier`), and pagination (`page`/`pageSize`,
  25 default, 100 max). Search runs against real SQLite **FTS5** virtual
  tables (`orders_fts`, `couriers_fts`, kept in sync via triggers on every
  insert/update/delete) using the **trigram** tokenizer — a real inverted
  index, not a `LIKE '%term%'` table scan, and one that matches substrings
  anywhere in the text (e.g. searching `364` finds a phone number with
  `364` in the middle of it), not just from the start of a word. The
  "Match a courier" flow on `admin.html` is a search-as-you-type dialog
  against the same index, not a `<select>` of every courier, so it stays
  usable regardless of roster size.
- **OTP delivery by SMS**: pluggable, not turned on by default — `sms.js`
  texts the recipient the delivery code via a generic HTTP call, configured
  entirely through `SMS_API_URL`/`SMS_API_KEY`/`SMS_SENDER_ID` (see
  `.env.example`). With no SMS gateway account set up, it silently no-ops
  and the OTP is still returned directly in the `POST /api/orders` response
  instead, exactly like before — nothing breaks by default. Ethiopian
  bulk-SMS gateways (AfroMessage, Geez SMS, etc.) each have their own
  endpoint/request shape, so `sms.js`'s request body is a starting point,
  not a real integration — expect to adjust it once you've actually signed
  up with one.

**What's explicitly NOT implemented** (out of scope for this prototype —
see the plan's own Section 9 for the full design):
- Real Fayda ID / biometric verification against the national API — the
  field is captured and format-checked, nothing more
- Payments / Telebirr / Chapa / wallet escrow
- The route-matching algorithm (Section 6) — courier assignment is a manual
  search-and-pick by an admin, not automatic matching by route/proximity
- Live GPS tracking
- The `GET /api/couriers/stats` leaderboard loads every delivered order and
  every courier into memory to aggregate — fine at prototype scale, but it's
  the one endpoint here that would need pagination/pre-aggregation (e.g. a
  materialized summary table) to hold up at millions of rows too
- Production-grade auth: no password reset, no rate limiting on login
  attempts, no CSRF protection, phone numbers aren't enforced unique (a
  duplicate-phone registration makes login ambiguous — it logs into
  whichever matching account was created first), and testimonials are
  posted with zero moderation.
- Authentication on the **operational** surfaces — `/admin.html`,
  `/couriers.html`, `/call-center.html`, `/earnings.html`, and most of their
  API routes still have **no auth**; anyone who can reach the site can see
  every courier's earnings via `GET /api/couriers/stats`. The courier-facing
  routes (`GET /api/orders/mine`, `GET /api/couriers/me/stats`) require
  login and only ever return that one courier's own data, and `POST
  /api/orders/:id/proof`/`PATCH /api/orders/:id/status` enforce order
  ownership *only when* a courier's own token is sent — calling them with no
  token at all (what the admin/call-center tools do) is still completely
  open. Neither is `/uploads/*`. Do not deploy this as-is anywhere public.

## Requirements

- [Node.js](https://nodejs.org) 22.5 or newer — the database layer uses
  Node's **built-in** `node:sqlite` module rather than `better-sqlite3`, so
  there's no native module to compile (no Python, no C++ build tools, no
  waiting on prebuilt binaries for your exact Node version). This backend has
  been run and exercised end-to-end (order creation, courier registration
  with Fayda ID validation, match → pickup → proof upload → OTP-gated
  delivery, delivery correctly refused with no proof / wrong OTP,
  invalid-transition rejection, file-type rejection on upload, admin
  listing, courier login/logout with wrong-password rejection, the
  leaderboard under all four sort orders, testimonial
  creation/listing/validation, and — seeded with ~100 test rows —
  full-text search including substring phone-number matching, combined
  search+filter queries, paginated navigation with no overlap between
  pages, and the search-as-you-type "match a courier" dialog) against a
  real Node 24 install.
  
  One real bug worth knowing about, since it's an easy trap: FTS5's
  "external content" tables (used here so the search index doesn't
  duplicate the row data) make a plain `SELECT`/`COUNT(*)` against the FTS
  table read straight through to the source table — so a naive
  "is the index empty?" check to decide whether to back-fill it is always
  wrong the moment the source table has rows, and search silently returns
  nothing despite the backfill code appearing to have run. Fixed by making
  the backfill an unconditional, idempotent `INSERT OR IGNORE` instead
  (see `db.js`) — confirmed by testing both versions directly against a
  real SQLite connection, not by reasoning about it.

## Run it locally

```powershell
cd server
npm install
npm start
```

Then open **http://localhost:3000** — that's the same marketing site as
before (served from `../website`), plus:

- `/order.html` — book a delivery (creates a real row via `POST /api/orders`)
- `/track.html` — track by code (`GET /api/orders/track/:code`)
- `/admin.html` — orders dashboard: match a courier, advance status, upload
  proof, confirm delivery with the OTP
- `/couriers.html` — register couriers (with Fayda ID + password) and see
  who's active
- `/login.html` → `/dashboard.html` — courier "Members" login, showing only
  that courier's own delivery count/amount/earnings
- `/earnings.html` — admin view of every courier's stats (no login) — under
  the "Admin" nav dropdown alongside Orders/Couriers/Call Center
- `/deliveries.html` — a logged-in courier's own assigned orders: mark
  picked up, upload proof, confirm delivery with the OTP
- `/testimonials.html` — public reviews from senders/receivers/couriers
- `/contact.html` — contact form (mailto-based, see `website/README.md`)
- `/call.html` — phone number for callers without internet access (static,
  no API)
- `/call-center.html` — an agent takes the same booking form over the phone
  (`POST /api/orders`), then assigns a courier inline (`PATCH
  /api/orders/:id/status`) without leaving the page — no new endpoints,
  just the existing order/courier APIs used together in one flow

The database file is created automatically at `server/data/adera-delivery.db`
on first run (SQLite, via Node's built-in `node:sqlite`) — nothing extra to
install or configure. Open it with DB Browser for SQLite, the VS Code SQLite
Viewer extension, or any SQLite client, once you've created some data.

## API reference

| Method | Path                        | Purpose                                             |
|--------|-----------------------------|------------------------------------------------------|
| GET    | `/api/tiers`                 | Pricing config (base fare + per-km rate + commission per tier) |
| POST   | `/api/orders`                 | Create an order — returns tracking code + OTP        |
| GET    | `/api/orders`                 | List orders (admin) — `?q=` full-text search, `?status=`, `?tier=`, `?page=`/`?pageSize=` (25 default, 100 max); response includes `total`/`page`/`pageSize`/`totalPages` |
| GET    | `/api/orders/mine`            | A logged-in courier's own assigned orders — **requires login** |
| GET    | `/api/orders/track/:code`     | Public lookup by tracking code (no OTP in response)  |
| POST   | `/api/orders/:id/proof`       | Upload photo/video proof (multipart, field name `proof`) — only while `picked_up`. Optional login: with a courier's token, the order must be theirs (403 otherwise); with no token, unchanged (admin/call-center) |
| PATCH  | `/api/orders/:id/status`      | Advance status; `matched` needs `courierId`, `delivered` needs proof already submitted **and** `otp`. Same optional-login ownership check as the proof upload above |
| GET    | `/api/couriers`               | List couriers — same `?q=`/`?status=`/`?page=`/`?pageSize=` pattern as orders |
| POST   | `/api/couriers`               | Register a courier — `multipart/form-data`: `fullName`, `phone`, `email`, `gender` (`female`\|`male`\|`other`\|`prefer_not_to_say`), `faydaId`, `password` (6+ chars), file fields `photo` and `faydaIdPhoto` — all required |
| PATCH  | `/api/couriers/:id/status`    | Admin sets `{ status }` to `active` or `inactive` |
| GET    | `/api/couriers/stats`         | **Admin view**: count/amount/earnings for every courier, no login — `?sort=recent\|amount\|earnings\|count&dir=asc\|desc` |
| GET    | `/api/couriers/me/stats`      | **Courier view**: the logged-in courier's own count/amount/earnings only — **requires login** |
| POST   | `/api/auth/login`             | `{ phone, password }` → `{ token, courier }`         |
| POST   | `/api/auth/logout`            | Invalidate the current session token (`Authorization: Bearer`) |
| GET    | `/api/auth/me`                | Logged-in courier's own profile — **requires login** |
| GET    | `/api/testimonials`           | List testimonials, most recent first, public         |
| POST   | `/api/testimonials`           | Submit one — `authorName`, `role` (`sender`\|`receiver`\|`courier`), `comment`, optional `rating` 1-5 |

Routes marked "requires login" expect `Authorization: Bearer <token>` from
`POST /api/auth/login`.

Example:

```powershell
curl -X POST http://localhost:3000/api/orders `
  -H "Content-Type: application/json" `
  -d '{"tier":"express","distanceKm":5,"senderName":"Abel","senderPhone":"0911000000","recipientName":"Sara","recipientPhone":"0922000000","pickupAddress":"Bole","dropoffAddress":"CMC"}'
```

## Deploying

This needs a **process host**, not static hosting — GitHub Pages won't run
it. Any small Node host works: [Render](https://render.com),
[Railway](https://railway.app), [Fly.io](https://fly.io), or a plain VM.

General steps (Render as an example):
1. Push this repo (or just the `server/` + `website/` folders) to GitHub.
2. Create a new **Web Service**, root directory `server/`, build command
   `npm install`, start command `npm start`.
3. Set the `PORT` env var if your host requires a specific one (most inject
   it automatically — `server.js` already reads `process.env.PORT`).

**Important caveat:** SQLite is a single file on local disk. Most free-tier
hosts wipe the filesystem on every redeploy, which means your data
disappears each time you ship a change. For anything beyond a demo, either:
- attach a persistent volume/disk to the SQLite file (`DATABASE_PATH` env
  var, read in `db.js`, lets you point it at a mounted volume), or
- swap `node:sqlite` for a hosted Postgres instance (Render/Railway/Supabase
  all offer one) — the schema in `db.js` is plain SQL and ports over with
  minor syntax changes (`AUTOINCREMENT` → `SERIAL`, etc.), and every query in
  `routes/` goes through the single `db` object, so that's the only file
  that needs rewriting. The FTS5 search tables don't have a Postgres
  equivalent to copy-paste — Postgres's own full-text search
  (`tsvector`/`GIN` index, or the `pg_trgm` extension for the same
  substring-matching behavior this uses) covers the same ground, but it's
  different syntax, so `db.js` and `search.js` would need real rewriting
  there, not just a connection-string swap.

**Also note:** `node:sqlite` is a newer Node API — double-check your chosen
host's Node runtime version is 22.5+ before deploying (most current hosts
default to Node 20 LTS images unless you pin a newer one).

## Project layout

```
server/
├── server.js          Express app: mounts /api/*, /uploads/*, serves ../website statically
├── db.js               SQLite connection + schema + additive migrations + FTS5 search index setup
├── search.js            FTS5 query builder + pagination query-param parsing (shared by orders/couriers)
├── auth.js               Password hashing (scrypt) + session token generation
├── uploads.js            multer configs — delivery proof (image/video, 25MB) and courier registration photos (image-only, 10MB)
├── sms.js                 OTP-by-SMS — no-ops until SMS_API_URL/SMS_API_KEY are set (see .env.example)
├── config/tiers.js      Pricing config — base/rate/commission, single source of truth
├── utils.js             Tracking-code / OTP generators
├── routes/
│   ├── orders.js         Create / list / track / "mine" / proof-upload / status-transition logic
│   ├── couriers.js       Register / list couriers, GET /stats (admin, all couriers) vs GET /me/stats (courier, own only)
│   ├── auth.js            login / logout / me + requireAuth + optionalAuth middleware (used by orders.js and couriers.js too)
│   └── testimonials.js   Public GET/POST for sender/receiver/courier reviews
├── .env.example          Template for SMS_API_URL/SMS_API_KEY/SMS_SENDER_ID — copy to .env (gitignored)
└── data/
    ├── adera-delivery.db  SQLite file, created at runtime (gitignored)
    └── uploads/              Proof photos/videos, created at runtime (gitignored)
```
