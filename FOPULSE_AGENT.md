# FoPulse — agent brief

Read in this order before changing code:

1. `FOPULSE_REQUIREMENTS.md` — product rules, delay, trigger definition, UI class names
2. `FOPULSE_SYSTEM.md` — files, APIs, Angel One, cron, Mongo, deploy

Rules of engagement:

- Smallest diff that preserves behaviour
- Public data = older than 30 days
- Admin data = all dates
- No live order APIs
- No `localhost` in `public/`
- Public dashboard markup must match admin (`sp-symbol-head`, `sp-row`, not `sp-card`)
- Strike values in master are ×100
- Expiry map = NFO OPTSTK only; skip expiries with 0 contracts
- Candle range = market hours IST
- Jobs append to Mongo; never drop collection on boot
- After `src/` edits: restart PM2 `kadavu`
- After `public/` edits: hard refresh is enough

Acceptance grep:

```bash
grep -n "sp-symbol-head\|Session day\|localhost:3003" public/js/dashboard.js
grep -n "DELAY_DAYS\|timezone" src/controllers/trigger.controller.js src/app.js
```
