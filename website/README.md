# Loyal Delivery Movers — Marketing Website + Booking Prototype

A marketing/pitch site for **Loyal Delivery Movers** (a Crowdsourced Urban
Logistics Platform for Addis Ababa), built directly from the project's full
business proposal — plus a small working booking/tracking/admin flow backed
by a real database (see `../server`).

**`index.html` is fully static** — no build step, no framework, no external
dependencies, deploys anywhere (GitHub Pages included) in minutes, and keeps
working even on slow connections. It presents the problem, the 4-tier
service model, an interactive client-side pricing calculator, the
security/chain-of-custody flow, market & financial highlights, the business
model, and the implementation roadmap.

**Every other page needs the Node server running** (`../server`) — `order.html`,
`track.html`, `admin.html`, `couriers.html`, `earnings.html`, `login.html`,
`dashboard.html`, `deliveries.html`, `testimonials.html`, and
`call-center.html` all call the real API (`/api/orders`, `/api/couriers`,
`/api/auth/*`, `/api/testimonials`) backed by SQLite. Opened as plain files,
or hosted on static-only hosting, their fetch calls will fail (they say so
on-screen rather than failing silently). `contact.html` and `call.html` are
the exceptions — `contact.html`'s form just opens the visitor's email client
(`mailto:`), and `call.html` is just a phone number with no API calls at
all. See `../server/README.md` to run the rest.

## Structure

```
website/
├── index.html            Marketing page — fully static, works standalone
├── order.html             Booking flow — needs the API
├── track.html              Order tracking — needs the API
├── admin.html                Ops dashboard (orders) — needs the API
├── couriers.html               Courier registration + roster — needs the API
├── earnings.html                 Admin view of every courier's stats — needs the API
├── login.html                      Courier "Members" login — needs the API
├── dashboard.html                    Courier's own stats only (logged in) — needs the API
├── deliveries.html                     "My Deliveries" — a courier's own assigned orders (logged in) — needs the API
├── testimonials.html                     Public reviews — needs the API
├── contact.html                            Contact form — static (mailto)
├── call.html                                 Phone number to call to book — static, no API
├── call-center.html                            Agent tool: take an order by phone, then assign a courier — needs the API
├── assets/
│   ├── css/style.css     Design tokens, light + dark mode, layout
│   └── js/
│       ├── main.js        Shared: nav/theme toggle, homepage calculator, contact form, nav dropdown
│       ├── order.js        Booking form logic
│       ├── track.js         Tracking lookup logic
│       ├── admin.js          Admin orders dashboard logic
│       ├── couriers.js         Courier registration + roster logic
│       ├── earnings.js           Admin: every courier's stats, sortable, no login
│       ├── login.js                Login form logic
│       ├── dashboard.js              Courier's own stats only — GET /api/couriers/me/stats
│       ├── deliveries.js               "My Deliveries" — own orders + pickup/proof/OTP actions
│       ├── testimonials.js               Testimonial list + submission logic
│       └── call-center.js                  Same booking logic as order.js, plus inline courier assignment
└── README.md
```

All thirteen pages share one header/footer nav, kept identical on purpose —
if you add a page or nav item, update it on every page, not just one. The
header groups `admin.html`/`couriers.html`/`call-center.html`/`earnings.html`
under one "Admin" dropdown (`.nav-dropdown` in `style.css`, opened/closed by
the generic handler in `main.js`) rather than four flat top-level items; the
footer still lists them flat, since a footer sitemap doesn't need the same
declutter a top nav bar does. If you add a fifth admin-only page, put it in
the dropdown menu on all thirteen pages, not as a new top-level item.

Note that "Members" now means two different things depending on where you
are: the top-level `dashboard.html` link is a courier's own login, showing
only their own numbers; `earnings.html`, inside the Admin dropdown, is the
full roster view. They're intentionally separate pages hitting separate API
endpoints (`GET /api/couriers/me/stats` vs `GET /api/couriers/stats`), not
the same page with a filter — a courier's login was never meant to be able
to request anyone else's numbers in the first place.

## Run it locally

Just open `index.html` in a browser — or serve it so relative paths behave
exactly like they will in production:

```powershell
# from inside the website/ folder
python -m http.server 8080
# then open http://localhost:8080
```

## Deploy to GitHub Pages

**Only covers the static marketing page and `contact.html`.** GitHub Pages
serves files, not a Node process, so `order.html`, `track.html`,
`admin.html`, `couriers.html`, `login.html`, `dashboard.html`, and
`testimonials.html` will load but their API calls will fail with an
on-screen "couldn't reach the API" message. If you want those working in
production, deploy `../server` instead (it serves this whole `website/`
folder itself, API included) — see `../server/README.md`.


1. Turn this folder into its own repo (or a subfolder of one):

   ```powershell
   cd website
   git init
   git add .
   git commit -m "Loyal Delivery Movers marketing site"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

2. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from
   a branch → Branch: `main` / `root`.**
3. The site publishes at `https://<your-username>.github.io/<your-repo>/`.

(If this folder lives inside a larger repo instead of being the repo root,
point GitHub Pages at `/website` as the folder, or move `index.html` and
`assets/` to the repo root.)

## Deploy anywhere else

It's static files — this also works unchanged on Netlify, Vercel, Cloudflare
Pages, or any basic web host: just upload the contents of `website/`.

## Before going live

- **Contact form** (`#contactForm` on `contact.html`) currently opens the
  visitor's email client via a `mailto:` link — swap the `submit` handler in
  `main.js` (guarded by `if (contactForm)`, shared across all pages) for a
  real endpoint (e.g. [Formspree](https://formspree.io), your own API) so
  submissions don't depend on the visitor having a mail client configured.
- **Placeholder contact details** — replace the email, phone, and address in
  `contact.html`, and the placeholder phone number on `call.html`
  (`tel:+251900000000`, marked on-page as a placeholder) with the real call
  center line before this goes live — neither is a working number.
- **`call-center.html` has no auth**, same caveat as `admin.html`/`couriers.html`
  — don't deploy this as-is anywhere public. It also doesn't do real
  "nearest courier" matching: there's no live GPS or route-matching in this
  prototype (see `../server/README.md`), so the agent picks a courier
  manually from a search box, same as the "Match a courier" flow on
  `admin.html`.
- **Members login is a prototype auth system** — passwords are hashed
  properly (server-side, `crypto.scrypt`), but there's no password reset, no
  login rate-limiting, and phone numbers aren't enforced unique. Don't treat
  it as production-ready; see `../server/README.md`.
- **Testimonials are unmoderated** — anyone can post one, and they appear
  immediately. Add a review/approval step before going live.
- **Financial and market figures** are pulled directly from the founding
  business plan (`Project requirement.pdf`) and are projections, not audited
  results — keep the "for illustration only" framing in the footer, or
  replace it once real figures exist.
- **Favicon/brand mark** is an inline SVG placeholder (a stylized "roof over a
  route" mark) — swap it for a real logo when one exists.

## Customizing

All colors are CSS custom properties defined once at the top of
`assets/css/style.css` (`:root`, the `@media (prefers-color-scheme: dark)`
block, and the `[data-theme="dark"]` / `[data-theme="light"]` overrides for
the in-page toggle). Change brand color, tier colors, or spacing tokens there
and the whole page updates.
