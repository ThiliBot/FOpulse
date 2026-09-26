# FoPulse / Session Pulse — System Document

**Audience:** coding agent that must change code safely  
**Companion:** `FOPULSE_REQUIREMENTS.md`  
**Production host:** Bluehost VPS `129.121.118.169`  
**App root:** `/var/www/kadavu`  
**PM2 name:** `kadavu`  
**Public origin:** `https://fopulse.com` (nginx → `127.0.0.1:3003`)

---

## 1. Runtime picture

```text
Browser
  ├─ /dashboard.html          public UI  → GET /api/triggers*
  ├─ /admin-dashboard.html    operator UI → GET /api/admin/triggers*
  ├─ /test-ui.html            TOTP login + POST /api/test/run-triggers
  └─ /status.html             token health

Nginx :80/:443
  └─ proxy_pass 127.0.0.1:3003

Node Express  (src/app.js)
  ├─ static public/
  ├─ /api/*  routes
  ├─ node-cron  Asia/Kolkata  weekdays
  └─ trigger.service.runTriggerJob(NIFTY50_SYMBOLS)

MongoDB 127.0.0.1:27017
  DB angelOneDashboard
  collection optiontriggers

Angel One SmartAPI
  loginByPassword → jwt + refresh + feed
  market quote (LTP / FULL)
  historical getCandleData (ONE_MINUTE)
  OpenAPIScripMaster.json (instrument dump)
```

Local Windows repos used in development:

- `D:\llmRepos\agnelOneAPIEngine`
- hosting copy may live under `D:\llmRepos\hostings\kadavu`

---

## 2. Repository layout (expected)

```text
kadavu/
  src/
    app.js
    config/
      db.js                 mongoose connect
      symbols.js            NIFTY50_SYMBOLS + aliases
    controllers/
      auth.controller.js    login / refresh / status / profile / logout
      trigger.controller.js public + admin reads, run-triggers
    routes/
      index.js              mounts /api
    services/
      token.service.js      memory + data/tokens.json, auto refresh
      instrument.service.js master cache, expiry map, near-ATM
      trigger.service.js    LTP → contracts → quotes → candles → Mongo
    models/
      OptionTrigger.js
    middlewares/            optional authenticate()
  public/
    dashboard.html + js/dashboard.js + css/
    admin-dashboard.html + js/admin-dashboard.js
    test-ui.html
    status.html
  data/
    tokens.json
    OpenAPIScripMaster.json
    equity_option_expiries.json   (optional cache)
  .env
  package.json
```

Node listens on `process.env.PORT || 3003`.  
`app.use('/api', authRoutes)` — trigger routes must be registered on the same router or a sibling `app.use('/api', triggerRoutes)`. If a new endpoint 404s, check `src/routes/index.js` first.

---

## 3. Environment

```env
PORT=3003
ANGEL_API_KEY=
ANGEL_CLIENT_CODE=
ANGEL_PASSWORD=
MONGODB_URI=mongodb://127.0.0.1:27017/angelOneDashboard
# optional
ADMIN_KEY=
```

Rules:

- `dotenv.config()` at process start (`app.js`).
- Login body may send only `totp`; server fills clientcode/password from env.
- Missing `ANGEL_API_KEY` → every Angel call fails (`X-PrivateKey` header).
- Never log full JWT or PIN.

---

## 4. Angel One integration

### 4.1 Headers (every authenticated call)

```text
Authorization: Bearer <jwt>
Content-Type: application/json
Accept: application/json
X-UserType: USER
X-SourceID: WEB
X-ClientLocalIP / X-ClientPublicIP / X-MACAddress
X-PrivateKey: ANGEL_API_KEY
```

### 4.2 Endpoints used

| Purpose | Method | URL |
|---------|--------|-----|
| Login | POST | `https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword` |
| Refresh | POST | `https://apiconnect.angelone.in/rest/auth/angelbroking/jwt/v1/generateTokens` |
| Logout | POST | `.../rest/secure/angelbroking/user/v1/logout` |
| Profile | GET | `.../rest/secure/angelbroking/user/v1/getProfile` |
| Quote | POST | `.../rest/secure/angelbroking/market/v1/quote/` |
| Candles | POST | `.../rest/secure/angelbroking/historical/v1/getCandleData` |
| Master | GET | `https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json` |

Quote body:

```json
{ "mode": "LTP", "exchangeTokens": { "NSE": ["1594"] } }
```

```json
{ "mode": "FULL", "exchangeTokens": { "NFO": ["52756", "..."] } }
```

Max ~50 tokens per quote call. Chunk.

Candle body:

```json
{
  "exchange": "NFO",
  "symboltoken": "52756",
  "interval": "ONE_MINUTE",
  "fromdate": "2026-09-16 09:15",
  "todate": "2026-09-16 15:30"
}
```

OHLC array index 4 = close. Use last 15 closes.

### 4.3 Token service contract

`token.service.js` is a singleton.

- `storeTokens(jwt, refresh, feed)`
- `getValidToken()` — return jwt or refresh
- `hasValidToken()` — true if > 5 minutes to `exp`
- persist to `data/tokens.json` on store/update; load on process start
- refresh failure → `clearTokens()` and throw. Do not retry forever.

Angel sessions typically die around midnight IST.

### 4.4 Known Angel pitfalls

| Symptom | Cause | Fix |
|---------|--------|-----|
| 403 on candles | burst / rate limit | 800–1000 ms gap between candle calls |
| 0 candles | from/to after 15:30 IST | clamp to market hours |
| Invalid totp | stale TOTP or wrong client | new 6-digit code |
| Failed to refresh | expired refresh | Test UI login again |
| 0 near-ATM contracts | strike not divided by 100 **or** expiry map includes non-NFO dates | divide strike; NFO-only map; skip expiry with 0 rows |

---

## 5. Instrument service

`loadMaster()`:

1. Memory if < 20 hours old
2. Else `data/OpenAPIScripMaster.json` if < 20 hours
3. Else download master URL and write disk

`buildCurrentNextExpiryMap()`:

- Only `exch_seg === 'NFO' && instrumenttype === 'OPTSTK'`
- Group unique `expiry` strings per `name` (uppercase)

`pickCurrentNext`:

- Parse expiry like `25AUG2026` / `29SEP2026`
- Today = start of day IST
- Current = first expiry ≥ today **with NFO row count > 0**
- Next = the following such expiry (optional for MVP)

`filterNearATM(contracts, spot)`:

- `realStrike = Number(item.strike) / 100` if values look like `301000`
- Sort unique strikes, pick ATM + 2 below + 2 above
- Keep CE and PE for those strikes

`getEquityToken(symbol)`:

- NSE cash: `exch_seg === 'NSE'` and symbol `NAME-EQ` or mapped alias (TMPV / TMCV).

---

## 6. Trigger job pipeline

`trigger.service.runTriggerJob(symbols)`

```text
1. getEquityLTP(symbols)           Quote LTP on NSE tokens
2. getCurrentAndNextContracts()    near-ATM NFO list (MVP: current only)
3. getQuotes(nfoTokens)            FULL quote, chunk 50
4. for each contract:
     getFifteenMinCandles(token)
     wait ~1s
     compute changePercent
     if abs >= 5  → push document
5. OptionTrigger.insertMany
```

Job is **long** (many minutes). HTTP handlers must not wait for it.

`POST /api/test/run-triggers` pattern:

```js
res.json({ status: true, message: 'Trigger job started...' });
triggerService.runTriggerJob(symbols).catch(log);
```

Nginx `proxy_read_timeout` should be ≥ 60s for other routes; background job avoids 502 HTML on the POST.

Cron (verify live `app.js` before editing):

```js
cron.schedule('15,45 9-15 * * 1-5', handler, { timezone: 'Asia/Kolkata' });
```

---

## 7. Data model

Mongo database: `angelOneDashboard`  
Collection: `optiontriggers` (mongoose model `OptionTrigger`)

```text
instrumentName     String   // master name e.g. INFY
symbol             String   // same for MVP
instrumentSector   String   // mapped sector or "Others"
volume             Number
expiry             String   // 25AUG2026
strikePrice        Number   // human strike 1170 not 117000
optionType         "CE"|"PE"
generatedTime      Date
triggerStartTime   Date     // first candle used
triggerEndTime     Date     // last candle used
triggerStartPrice  Number
triggerEndPrice    Number
changePercent      Number
priceSequence      [Number] // ~15 closes
createdAt updatedAt
```

Indexes: symbol+time, changePercent, generatedTime+sector.

Writes are insert-only. Clearing data is a manual mongosh action, never boot-time.

Public delay filter (conceptual):

```text
cutoff = now - 30 days
keep if triggerEndTime <= cutoff
     or (no end time AND generatedTime <= cutoff)
```

Date query bounds are IST:

```text
2026-08-10T00:00:00+05:30  ..  2026-08-10T23:59:59.999+05:30
```

---

## 8. HTTP API catalogue

All JSON envelopes use `{ status: true|false, message?, data? }`.

### Auth

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/login` | `{ clientcode?, password?, totp }` |
| POST | `/api/refresh` | uses stored refresh |
| GET | `/api/status` | token validity / remaining time |
| GET | `/api/profile` | Angel profile |
| POST | `/api/logout` | best-effort Angel logout + clear |

### Triggers

| Method | Path | Query |
|--------|------|-------|
| GET | `/api/triggers` | minChange, limit≤200, page, date |
| GET | `/api/triggers/dates` | minChange |
| GET | `/api/admin/triggers` | same, no delay |
| GET | `/api/admin/triggers/dates` | no delay |
| POST | `/api/test/run-triggers` | body.symbols optional |

Public responses include `delayDays: 30`.

---

## 9. Frontend binding

| Page | Script | Data |
|------|--------|------|
| dashboard.html | /js/dashboard.js | `/api/triggers`, `/api/triggers/dates` |
| admin-dashboard.html | /js/admin-dashboard.js | `/api/admin/*`, optional `X-Admin-Key` |
| test-ui.html | inline | `/api/login`, `/api/test/run-triggers` |

`const BASE = window.location.origin` then `/api/...`.

Public dashboard load sequence:

1. `GET /api/triggers/dates?minChange=5`
2. For each date, page through `GET /api/triggers?date=&limit=200`
3. Render date tabs (`All public` + each day)
4. Client filter/sort; score = `abs(%) * log10(vol+10)`

Admin render templates (copy these class names on public):

```html
<li class="sp-top-item">
  <span class="sp-top-rank">1</span>
  <span class="sp-top-sym">TATASTEEL</span>
  <span class="sp-type pe">PE</span>
  <!-- spark -->
  <span class="sp-delta down">-16.0%</span>
  <span class="sp-vol">1.06 Cr</span>
</li>

<article class="sp-symbol">
  <header class="sp-symbol-head">...</header>
  <div class="sp-symbol-body">
    <div class="sp-row pe">
      <span class="sp-strike">182.5</span>
      <span class="sp-type pe">PE</span>
      <span class="sp-win">12:29–12:43</span>
      <span class="sp-px">2.75→2.31</span>
      <span class="sp-delta down">-16.00%</span>
      <span class="sp-vol">1.06 Cr</span>
    </div>
  </div>
</article>
```

Shared CSS: `/css/dashboard.css`, `/css/theme.css`.  
Do not add a competing `<style>` that redefines `.sp-row`.

---

## 10. Deploy / operate

```bash
cd /var/www/kadavu
pm2 start src/app.js --name kadavu   # first time
pm2 restart kadavu
pm2 logs kadavu --raw
pm2 save && pm2 startup

mongosh angelOneDashboard --eval "db.optiontriggers.countDocuments()"
curl -sS http://127.0.0.1:3003/
curl -sS https://fopulse.com/api/triggers/dates?minChange=5
```

Static files: overwrite `public/` then hard-refresh (`?v=N`). Node need not restart for HTML/JS. Restart **is** required after `src/**` changes.

Daily operator loop:

1. Open Test UI, enter TOTP if `/api/status` says no session
2. Confirm cron logs `⏰ Cron triggered at … IST`
3. Admin dashboard shows today’s tab after the job finishes

---

## 11. Rate-limit budget (design constraint)

Rough per full Nifty 50 current-expiry scan:

- 1–2 LTP quote calls (50 tokens)
- 1–N FULL quote chunks for option tokens
- One historical call **per contract** (often 8–20 contracts × 50 names if unfiltered; near-ATM should keep this to low hundreds)

Candle API is the bottleneck. Never parallelize candles. Prefer fewer contracts over a faster broken job.

---

## 12. Known defects to respect (do not reintroduce)

1. Public JS that injects `#f-date` / `Session day` instead of `#date-tabs`.
2. Public JS that renders `sp-card` / `sp-group` — CSS will not match admin.
3. Homepage served from a file that still points at old `dashboard.js`.
4. `index.html` may be absent; `/` currently returns JSON health. Humans use `/dashboard.html`.
5. In-memory instrument cache survives process lifetime — after master/expiry logic changes, `pm2 restart kadavu`.
6. `TATAMOTORS` vs `TMPV` token mapping.
7. Strike × 100.
8. Expiry list polluted by BFO / dead weeklies if NFO filter is dropped.

---

## 13. Test commands for an agent

```bash
# public delay
curl -sS "https://fopulse.com/api/triggers?date=$(date +%F)&minChange=5" 
# expect count 0 if today is inside 30-day window

# delayed day that exists
curl -sS "https://fopulse.com/api/triggers/dates?minChange=5"

# files on VPS
grep -n "sp-symbol-head\|Session day\|localhost:3003" /var/www/kadavu/public/js/dashboard.js
grep -n "timezone: 'Asia/Kolkata'" /var/www/kadavu/src/app.js
```

Local mongosh:

```js
use angelOneDashboard
db.optiontriggers.countDocuments()
db.optiontriggers.find({ changePercent: { $gte: 5 } }).limit(2)
```

---

## 14. What to edit for common tasks

| Task | Files |
|------|--------|
| Change ±5% threshold | `trigger.service.js` THRESHOLD + UI default inputs + API `minChange` default |
| Change 30-day delay | `trigger.controller.js` `DELAY_DAYS` only |
| Add/remove underlyings | `src/config/symbols.js` |
| Sector labels | mapping used when building trigger docs |
| Scan hours | candle clamp + cron in `app.js` |
| Public look | `public/js/dashboard.js` templates only — copy admin strings |
| Login/TOTP | `auth.controller.js`, `token.service.js` |
| Rate limit | sleep in `trigger.service.js` candle loop |

---

## 15. Out of scope siblings

A separate capstone (HTTP HIDS / Teler) was planned on the same domain (`/hids`). It is **not** this scanner. Do not fold HIDS into trigger services.
