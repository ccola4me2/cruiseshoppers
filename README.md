# CruiseShoppers

A professional, authenticated cruise lead-generation site for US cruise shoppers.
Visitors must create an account and log in before they can access any sailing
content. Once signed in they get a searchable, filterable catalog of cruise
sailings (cruise line, ship, dates, departure/destination ports, and full
itineraries) powered by the **Widgety API**. There is **no live pricing** anywhere.
Every sailing has a **Request a Quote** button that captures the visitor's
contact info plus the exact sailing/itinerary and pre-fills a **GoHighLevel (GHL)**
form.

## Architecture

| Layer | Tech |
|---|---|
| Hosting | Cloudflare Worker + static assets (auto-deploys from GitHub `main`) |
| Auth | Self-hosted: email/password, PBKDF2 hashing (Web Crypto), DB-backed sessions, password reset |
| Database | Cloudflare D1 (SQLite): `users`, `sessions`, `password_reset_tokens` |
| Reset email | Resend (transactional email) |
| Sailing data | Widgety cruises API, proxied server-side (credentials never reach the browser) |
| Lead capture | GHL form embed, pre-filled via URL params |

```
src/
  worker.js     Router: API + auth-gating + static assets
  auth.js       Signup / login / logout / me / forgot / reset
  widgety.js    Auth-gated /api/sailings proxy + normalization (no pricing)
  db.js         D1 query helpers
  email.js      Resend reset email
  util.js       Crypto, cookies, JSON helpers
public/         Static site (landing, auth pages, catalog, quote)
migrations/     D1 schema
```

## Access control

- Public: `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, and `/api/auth/*`.
- **Gated** (require a valid session): `/app` (the sailings catalog), `/quote`, and
  `/api/sailings` (the sailing data itself). Unauthenticated page requests redirect
  to `/login?next=…`; unauthenticated API requests get `401`.

---

## Setup / deploy

You don't need Node locally. Cloudflare builds and deploys from GitHub. The
`wrangler` commands below can be run from the Cloudflare dashboard's D1 console or
by anyone with Node; they're listed for completeness.

### 1. Create the D1 database
In the Cloudflare dashboard: **Workers & Pages → D1 → Create** a database named
`cruiseshoppers`. Copy its **Database ID** into `wrangler.toml` (`database_id`).

Then apply the schema: either paste `migrations/0001_init.sql` into the D1
**Console** tab, or run:
```bash
npx wrangler d1 migrations apply cruiseshoppers --remote
```

### 2. Deploy the Worker
Connect this GitHub repo under **Workers & Pages → Create → Connect to Git**, or:
```bash
npx wrangler deploy
```

### 3. Set secrets
In the dashboard (**Worker → Settings → Variables → Secrets**) or via CLI:
```bash
npx wrangler secret put WIDGETY_APP_ID     # your Widgety app id
npx wrangler secret put WIDGETY_TOKEN       # your Widgety token
npx wrangler secret put RESEND_API_KEY      # for password-reset emails
```
> **Widgety note:** Widgety authenticates with an **app_id + token pair**, not a
> single key. The placeholder `WIDGETY_API_KEY_HERE` appears in `src/widgety.js`
> as a fallback; prefer setting the two secrets above. Until they're set,
> `/api/sailings` returns a friendly "not configured" message.

Non-secret config lives in `[vars]` in `wrangler.toml` (`APP_URL`, `MAIL_FROM`,
`SESSION_TTL_DAYS`, `RESET_TTL_MINUTES`).

### 4. Connect GoHighLevel (quote capture)
In `public/js/quote.js`:
1. Replace `GHL_FORM_EMBED_URL_HERE` with your GHL form's embed URL
   (GHL form builder → **Integrate** → copy the iframe `src`).
2. In GHL, create custom fields and set each field's **Query Key** to match:
   `cruise_line`, `ship_name`, `sailing_dates`, `departure_port`,
   `destination`, `itinerary_details`. Standard contact fields
   (`first_name`, `last_name`, `email`, `phone`) pre-fill automatically.

When a visitor clicks **Request a Quote**, the selected sailing + itinerary and
their account contact details are passed to the embedded GHL form as URL params,
so GHL pre-populates the matching fields.

### 5. Verify the Widgety field mapping
Field names in the cruises payload can vary. After adding credentials, sign in and
open **`/api/sailings?debug=raw`** to see the raw first cruise objects, then adjust
the `normalizeSailing` mappings in `src/widgety.js` if any field lands empty. (No
pricing fields are ever read or displayed.)

---

## Security notes
- Passwords hashed with PBKDF2-SHA256 (100k iterations, per-user salt).
- Sessions: only a SHA-256 hash of the session token is stored server-side; the
  raw token lives in an `HttpOnly; Secure; SameSite=Lax` cookie.
- Password reset: single-use, time-limited tokens (hashed at rest); resetting a
  password invalidates all existing sessions. `forgot-password` always returns a
  generic response (no account enumeration).
