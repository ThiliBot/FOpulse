# FoPulse / Session Pulse — Product Requirements

**Audience:** coding agent maintaining this app without product owner on the call  
**Status:** MVP in production  
**Public site:** https://fopulse.com  
**Last aligned:** 2026-09-26  

This document is the source of truth for *what the product must do*.  
Do not invent features. Prefer the smallest change that preserves behaviour.

---

## 1. Product one-liner

FoPulse (UI brand: **Session Pulse**) scans Nifty 50 equity options during Indian market hours, records 15-minute premium moves of **±5% or more**, stores them in MongoDB, and shows them on two dashboards:

- **Public dashboard** — delayed by **30 calendar days**
- **Admin dashboard** — all dates, no delay

It is **not** a broker, not an order-routing system, and not live trading advice. It is an archive + scanner of option-premium pressure.

---

## 2. Goals (must keep)

| ID | Goal |
|----|------|
| G1 | Detect near-ATM CE/PE moves ≥ +5% or ≤ −5% in a ~15-minute window |
| G2 | Persist every qualifying trigger for year-end review (“how many triggers did we find”) |
| G3 | Public site never shows last 30 days of scans |
| G4 | Admin can see today and run/inspect jobs |
| G5 | Stay inside Angel One SmartAPI rate limits |
| G6 | App survives VPS reboot (PM2 + Mongo + tokens file) |
| G7 | UI stays one-page, dark, tile/row based — public look = admin look |

---

## 3. Non-goals (do not build unless asked)

- Order placement, basket orders, or broker checkout
- Websocket live ticks as the MVP data path
- Next-expiry / weekly chain as a first-class scan target (MVP = **current monthly / current usable NFO expiry only**)
- Multi-user accounts, billing, or public signup
- Changing `DELAY_DAYS` without an explicit product decision
- Rewriting the stack (no Next.js, no Redis, no Kafka for MVP)

---

## 4. Users

| Actor | Access | Can see |
|-------|--------|---------|
| Anonymous visitor | `fopulse.com/dashboard.html` | Triggers older than 30 days, ±5% filter |
| Operator | `test-ui.html`, `status.html`, `admin-dashboard.html` | Login with TOTP, run job, all dates |
| System cron | PM2 process `kadavu` | Writes Mongo during market hours |

Public APIs must work **without** JWT. Admin/live pages may require an admin key and/or an Angel session for *writes*, not for reading stored rows.

---

## 5. Functional requirements

### 5.1 Universe

- Underlying list = Nifty 50 cash symbols in `src/config/symbols.js` (`NIFTY50_SYMBOLS`).
- Alias example already in product: Tata Motors / TMPV / TMCV must still resolve to a valid NSE equity token.
- Options = NSE F&O `OPTSTK` on **NFO only**.
- Strikes = near ATM: **2 strikes below and 2 above** current spot (plus ATM), both CE and PE.
- Angel One master stores strike as **spot × 100**. Always compare using `strike / 100`.

### 5.2 Expiry selection

- Build expiry map only from `exch_seg === 'NFO'` and `instrumenttype === 'OPTSTK'`.
- Current expiry = first expiry date **≥ today IST** that has **NFO contract rows > 0**.
- Do not pick a leftover series (example failure: `24SEP2026` with 0 NFO contracts while live series is `29SEP2026`).
- Next expiry exists in code paths but **MVP scan may ignore next expiry**.

### 5.3 Trigger definition

A trigger is saved only when **all** are true:

1. Contract is near-ATM for that underlying and current usable expiry.
2. A 1-minute candle window produced at least 2 closes (prefer last 15 closes).
3. `changePercent = (end − start) / start * 100`
4. `abs(changePercent) >= 5`
5. Volume comes from live quote (`tradeVolume`) when available.

Window rules:

- **Market hours (09:15–15:30 IST):** last ~15–25 minutes of 1-min candles.
- **After hours / weekend job:** clamp request to that day’s **09:15–15:30 IST**. Never request future or post-15:30 candles (Angel historical returns empty / waste quota).

`triggerStartTime` / `triggerEndTime` must match the first and last candle actually used, not “now − 15 min” wall clock if the candle timestamps differ.

### 5.4 Persistence

Each saved document matches `OptionTrigger` (see system doc). Jobs **append**; they must not wipe the collection on server start.

### 5.5 Public API behaviour

| Endpoint | Rule |
|----------|------|
| `GET /api/triggers` | Only rows older than `DELAY_DAYS` (30). Default `minChange=5`. Paginate `limit` max 200. |
| `GET /api/triggers?date=YYYY-MM-DD` | That IST day only, still delayed. If day is inside the 30-day window, return empty + message. |
| `GET /api/triggers/dates` | Distinct IST days older than 30 days with ±minChange counts. |

### 5.6 Admin API behaviour

| Endpoint | Rule |
|----------|------|
| `GET /api/admin/triggers` | No 30-day filter. Same query shape. |
| `GET /api/admin/triggers/dates` | All days in DB. |
| `POST /api/test/run-triggers` | Starts job in **background**, returns immediately. Optional body `{ "symbols": ["INFY"] }`. Default = full Nifty 50 list. |

Admin UI may send `X-Admin-Key`. Keep that check if present; do not remove security while “simplifying”.

### 5.7 Auth (Angel One)

- Market data needs a JWT from `loginByPassword` (clientcode + PIN + TOTP).
- API key alone is **not** enough.
- Persist `{ jwtToken, refreshToken, feedToken, expiresAt }` to `data/tokens.json` so PM2 restart does not demand TOTP.
- Refresh JWT when < 5 minutes remain. On refresh failure, clear tokens and require login — do not loop.
- TOTP is still required about once per calendar day / when refresh dies. Product accepts this for MVP (operator uses Test UI).

### 5.8 Scheduling

- Cron in `src/app.js` uses timezone **`Asia/Kolkata`**, weekdays only.
- Current production expression (verify in `app.js` before changing):  
  `'15,45 9-15 * * 1-5'` or `'30 9-15 * * 1-5'`  
  Meaning: fire during cash session, not UTC clock.
- VPS OS clock may be UTC; cron timezone option is what matters.
- A run of ~50 underlyings × near-ATM contracts **must** pace candle calls (~1s gap). Burst calls cause HTTP 403.

### 5.9 UI

**Public (`/dashboard.html`)**

- Load `/api/triggers/dates` then all public pages for those dates (API cap 200/page).
- Default = recent date not “today”.
- Filters: min Δ%, min volume, sector, CE/PE, sort (score / |Δ%| / volume / newest).
- Top 5 by score + grouped rows by underlying.
- Markup **must** reuse admin classes so `dashboard.css` applies:  
  `sp-top-item`, `sp-top-rank`, `sp-top-sym`, `sp-type`, `sp-row ce|pe`, `sp-symbol`, `sp-symbol-head`, `sp-strike`, `sp-win`, `sp-px`, `sp-delta`, `sp-vol`, `sp-chip`.
- No `localhost` URLs. Always `window.location.origin`.

**Admin (`/admin-dashboard.html`)**

- Same visual system.
- Date tabs from `/api/admin/triggers/dates`.
- Actions: run trigger job, link to public view, status, clear admin key.
- May use `X-Admin-Key` from `sessionStorage`.

**Test UI (`/test-ui.html`)**

- TOTP-only login if clientcode/password live in `.env`.
- Manual `POST /api/test/run-triggers`.
- Same origin `/api` base.

### 5.10 Operational pages

- `GET /` health JSON is acceptable; product home for humans is `dashboard.html`.
- `GET /status` → `public/status.html` (token validity).

---

## 6. Non-functional requirements

| Area | Requirement |
|------|-------------|
| Runtime | Node.js + Express, static `public/`, MongoDB local |
| Process | PM2 name `kadavu`, listen `127.0.0.1:3003` |
| Proxy | Nginx → port 3003; long jobs must not block HTTP (background run-triggers) |
| Secrets | `.env` chmod 600; never commit API key, PIN, TOTP secret, admin key |
| Mongo | Do not expose `27017` to the internet |
| Rate limit | Batch quotes (≤50 tokens). Serialize historical candle calls |
| Time | All session windows in IST (`Asia/Kolkata`) |
| Logging | Verbose job logs are desired: symbols scanned, contracts kept, API count, skips, saves |

---

## 7. Compliance / product policy

- Public delay of **30 days** is intentional (treat as regulatory / product policy).
- Do not label delayed tiles as “live”.
- Footer/status on public page must mention the delay.

---

## 8. Acceptance checks (agent must run these mentally before a PR)

1. Public `/api/triggers/dates` never includes a day inside the last 30 days.
2. `GET /api/triggers?date=<today>` is empty.
3. Admin dates include today after a successful scan.
4. New scan does not delete old Mongo rows.
5. Public dashboard HTML contains `id="date-tabs"` and JS contains `sp-symbol-head` (not `sp-card` / `Session day`).
6. Strike filter uses `strike/100` vs spot.
7. Expiry map uses NFO-only rows; current expiry has contracts > 0.
8. Candle `fromdate`/`todate` never sit after 15:30 IST on a closed session.
9. No hardcoded `http://localhost:3003` in `public/`.
10. Cron timezone is `Asia/Kolkata`.

---

## 9. Change control for a coding agent

When editing:

1. Read this file + `FOPULSE_SYSTEM.md`.
2. Touch the smallest number of files.
3. Do not “upgrade” dependencies unless a file will not run.
4. Do not expand scan universe (Nifty Next 50, commodities, index options) without a new requirement.
5. After UI edits, grep for leftover `localhost`, `sp-card`, `Session day`.
6. After instrument/trigger edits, confirm logs: `CURRENT (…): found N total contracts` with N > 0.

---

## 10. Glossary

| Term | Meaning |
|------|---------|
| Trigger | One saved near-ATM option that moved ≥ ±5% in the window |
| Score | `abs(changePercent) * log10(volume + 10)` — UI ranking only |
| Current expiry | Nearest future NFO expiry that actually has contracts |
| Public archive | All triggers with event time ≤ now − 30 days |
| Session Pulse | Marketing name of the dashboard |
| FoPulse / kadavu | Product + VPS project folder / PM2 name |
