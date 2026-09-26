# FoPulse — Session Pulse

Nifty 50 equity-options scanner. It watches near-ATM CE/PE premiums, records **±5%** moves over a **~15-minute** window, stores them in MongoDB, and shows them on a one-page dashboard.

**Public site:** [fopulse.com](https://fopulse.com)  
**Public data is delayed by 30 days.** Same-day scans are admin-only.

This is an archive and scanner, not a broker and not an order-routing system.

---

## What it does

1. Loads Angel One scrip master (NFO `OPTSTK` only).
2. Takes Nifty 50 spot LTPs.
3. Picks current usable expiry and **ATM ± 2 strikes** (CE + PE).
4. Pulls 1-minute candles for that window.
5. Saves a trigger when `|changePercent| >= 5`.
6. Public API/UI expose only rows older than 30 days.

---

## Stack

| Piece | Choice |
|-------|--------|
| Runtime | Node.js + Express |
| DB | MongoDB (`angelOneDashboard.optiontriggers`) |
| Broker API | Angel One SmartAPI (JWT + TOTP) |
| Process | PM2 (`kadavu`) |
| Proxy | Nginx → `127.0.0.1:3003` |
| UI | Static HTML/CSS/JS in `public/` |

---

## Repo layout

```text
src/
  app.js
  config/          db + NIFTY50_SYMBOLS
  controllers/     auth + triggers
  services/        token, instrument, trigger job
  models/          OptionTrigger
public/
  dashboard.html           public UI
  admin-dashboard.html     all dates, no delay
  test-ui.html             TOTP login + manual job
  js/  css/
data/                      tokens.json, cached scrip master
docs/                      FOPULSE_REQUIREMENTS.md, FOPULSE_SYSTEM.md
```

---

## Local setup

```bash
cp .env.example .env
# fill ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_PASSWORD
npm install
# Mongo running on 127.0.0.1:27017
npm run dev
# or: node src/app.js
```

`.env`:

```env
PORT=3003
ANGEL_API_KEY=
ANGEL_CLIENT_CODE=
ANGEL_PASSWORD=
MONGODB_URI=mongodb://127.0.0.1:27017/angelOneDashboard
```

Open:

- Health: `http://localhost:3003/`
- Public UI: `http://localhost:3003/dashboard.html`
- Admin UI: `http://localhost:3003/admin-dashboard.html`
- Login / manual scan: `http://localhost:3003/test-ui.html`

Login needs a fresh TOTP. Client code and PIN can stay in `.env`; Test UI can send only `totp`.

---

## API (short)

| Method | Path | Notes |
|--------|------|--------|
| POST | `/api/login` | `{ totp }` (+ env clientcode/password) |
| GET | `/api/status` | JWT validity |
| GET | `/api/triggers` | public, 30-day delay, `minChange`, `date`, `page`, `limit` |
| GET | `/api/triggers/dates` | public day list |
| GET | `/api/admin/triggers` | no delay |
| GET | `/api/admin/triggers/dates` | no delay |
| POST | `/api/test/run-triggers` | starts job in background |

Never hardcode `http://localhost:3003` in `public/` — use `window.location.origin`.

---

## Job + cron

`trigger.service.runTriggerJob(NIFTY50_SYMBOLS)`:

spot LTP → near-ATM contracts → quotes → 1-min candles (paced) → Mongo insert.

Cron in `src/app.js` uses timezone **`Asia/Kolkata`**, weekdays, cash-session hours.  
Candle requests must stay inside **09:15–15:30 IST**. After hours, clamp to that day’s session.

Angel historical calls rate-limit quickly (HTTP 403). The job waits ~1s between candle requests.

---

## Rules that must not drift

- Public delay = **30 days** (`DELAY_DAYS` in `trigger.controller.js`)
- Threshold = **±5%**
- Master strike is often **spot × 100** — divide before ATM compare
- Expiry map = **NFO OPTSTK only**; skip expiries with 0 contracts
- Jobs **append** to Mongo; do not wipe the collection on boot
- Public dashboard markup must match admin classes (`sp-symbol-head`, `sp-row`, not `sp-card`)

Agent-facing specs:

- [FOPULSE_REQUIREMENTS.md](FOPULSE_REQUIREMENTS.md)
- [FOPULSE_SYSTEM.md](FOPULSE_SYSTEM.md)
- [FOPULSE_AGENT.md](FOPULSE_AGENT.md)

---

## Production notes

```bash
pm2 start src/app.js --name kadavu
pm2 logs kadavu --raw
mongosh angelOneDashboard --eval "db.optiontriggers.countDocuments()"
```

Static files under `public/` do not need a PM2 restart. `src/` changes do.

Keep `.env` and `data/tokens.json` off git. Do not expose Mongo `27017` to the internet.

---

## License

Private / unspecified. Market data belongs to the exchange and the broker terms you signed.
