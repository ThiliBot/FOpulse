// src/services/instrument.service.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MASTER_URL =
  'https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json';
const CACHE_FILE = path.join(__dirname, '../../data/OpenAPIScripMaster.json');

const MONTHS = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11
};

const SYMBOL_ALIASES = {
  TMCV: ['TMCV', 'TMPV', 'TATAMOTORS'],
  TMPV: ['TMPV', 'TMCV', 'TATAMOTORS'],
  TATAMOTORS: ['TATAMOTORS', 'TMCV', 'TMPV'],
  LTIM: ['LTIM', 'LTM'],
  LTM: ['LTM', 'LTIM']
};

let masterCache = null;
let masterLoadedAt = null;
let currentNextExpiryCache = null;
let expiryCacheLoadedAt = null;

function startOfTodayIst() {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

function parseExpiry(raw) {
  const m = String(raw || '')
    .toUpperCase()
    .match(/^(\d{1,2})([A-Z]{3})(\d{4})$/);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month == null) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
}

function countNfoContracts(master, name, expiry) {
  let n = 0;
  for (const item of master) {
    if (
      item.exch_seg === 'NFO' &&
      item.instrumenttype === 'OPTSTK' &&
      item.name === name &&
      item.expiry === expiry
    ) {
      n += 1;
    }
  }
  return n;
}

function pickCurrentNext(expirySet, master, name) {
  const today = startOfTodayIst();
  const sorted = [...expirySet]
    .map((raw) => ({ raw, at: parseExpiry(raw) }))
    .filter((x) => x.at)
    .sort((a, b) => a.at - b.at || String(a.raw).localeCompare(String(b.raw)));

  const usable = sorted.filter((x) => x.at >= today && countNfoContracts(master, name, x.raw) > 0);

  return {
    current: usable[0]?.raw || null,
    next: usable[1]?.raw || null,
    all: sorted.map((x) => x.raw)
  };
}

function lookupNames(symbol) {
  const upper = String(symbol || '').toUpperCase();
  return SYMBOL_ALIASES[upper] || [upper];
}

async function loadMaster(forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    masterCache &&
    masterLoadedAt &&
    now - masterLoadedAt < 20 * 60 * 60 * 1000
  ) {
    return masterCache;
  }

  if (!forceRefresh && fs.existsSync(CACHE_FILE)) {
    const stats = fs.statSync(CACHE_FILE);
    const ageHours = (now - stats.mtimeMs) / 36e5;
    if (ageHours < 20) {
      masterCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      masterLoadedAt = now;
      console.log(`📦 [Master] Using disk cache (${masterCache.length} instruments)`);
      return masterCache;
    }
  }

  try {
    console.log('⬇️ [Master] Downloading...');
    const { data } = await axios.get(MASTER_URL, {
      timeout: 120000,
      headers: { Accept: 'application/json' },
      decompress: true,
      responseType: 'json'
    });

    if (!Array.isArray(data) || data.length < 1000) {
      throw new Error('Master response invalid');
    }

    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
    masterCache = data;
    masterLoadedAt = now;
    currentNextExpiryCache = null;
    expiryCacheLoadedAt = null;
    console.log(`✅ [Master] Saved ${data.length} instruments`);
    return masterCache;
  } catch (err) {
    console.error('❌ [Master] Download failed:', err.message);
    if (fs.existsSync(CACHE_FILE)) {
      masterCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      masterLoadedAt = now;
      console.log('📦 [Master] Fallback to disk cache');
      return masterCache;
    }
    throw err;
  }
}

async function buildCurrentNextExpiryMap(forceRefresh = false) {
  const now = Date.now();

  if (
    !forceRefresh &&
    currentNextExpiryCache &&
    expiryCacheLoadedAt &&
    now - expiryCacheLoadedAt < 20 * 60 * 60 * 1000
  ) {
    console.log(
      `📦 [ExpiryMap] Using in-memory cache (${Object.keys(currentNextExpiryCache).length} symbols)`
    );
    return currentNextExpiryCache;
  }

  console.log('🔨 [ExpiryMap] Building Current + Next expiry map from live master dates...');
  const master = await loadMaster(forceRefresh);
  const expiryMap = {};
  let optstkCount = 0;

for (const scrip of master) {
  if (
    scrip.exch_seg === 'NFO' &&
    scrip.instrumenttype === 'OPTSTK' &&
    scrip.name &&
    scrip.expiry
  ) {
    optstkCount += 1;
    const name = String(scrip.name).toUpperCase();
    if (!expiryMap[name]) expiryMap[name] = new Set();
    expiryMap[name].add(scrip.expiry);
  }
}

  console.log(
    `   Scanned ${optstkCount} OPTSTK contracts across ${Object.keys(expiryMap).length} underlyings`
  );

  const result = {};
  for (const [symbol, expirySet] of Object.entries(expiryMap)) {
    result[symbol] = pickCurrentNext(expirySet, master, symbol);
  }

  currentNextExpiryCache = result;
  expiryCacheLoadedAt = now;
  console.log(`✅ [ExpiryMap] Ready for ${Object.keys(result).length} symbols`);
  return result;
}

async function getCurrentAndNextExpiry(symbol) {
  const map = await buildCurrentNextExpiryMap();
  const names = lookupNames(symbol);
  let info = { current: null, next: null, all: [] };
  for (const name of names) {
    if (map[name]) {
      info = map[name];
      break;
    }
  }
  console.log(`   [Expiry] ${symbol} → Current: ${info.current} | Next: ${info.next}`);
  return info;
}

function filterNearATM(contracts, currentPrice, strikesAround = 2) {
  if (!contracts.length || !currentPrice) {
    console.log('   [NearATM] Skipped — no contracts or no price');
    return [];
  }

  const uniqueStrikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);

  let atmIndex = 0;
  let minDiff = Infinity;
  uniqueStrikes.forEach((strike, idx) => {
    const diff = Math.abs(strike - currentPrice);
    if (diff < minDiff) {
      minDiff = diff;
      atmIndex = idx;
    }
  });

  const start = Math.max(0, atmIndex - strikesAround);
  const end = Math.min(uniqueStrikes.length, atmIndex + strikesAround + 1);
  const allowedStrikes = uniqueStrikes.slice(start, end);
  const filtered = contracts.filter((c) => allowedStrikes.includes(c.strike));

  console.log(
    `   [NearATM] Price: ${currentPrice} | ATM ~${uniqueStrikes[atmIndex]} | ` +
      `Allowed: [${allowedStrikes.join(', ')}] | ` +
      `${contracts.length} → ${filtered.length}`
  );

  return filtered;
}

async function getCurrentAndNextContracts(symbols = [], currentPrices = {}) {
  console.log('\n========== [Instrument] Building Near-ATM Contract List ==========');
  console.log(`Requested symbols: ${symbols.join(', ')}`);

  const map = await buildCurrentNextExpiryMap();
  const master = await loadMaster();
  const result = [];

  for (const symbol of symbols) {
    const names = lookupNames(symbol);
    const mappedName = names.find((n) => map[n]);
    const expiryInfo = mappedName ? map[mappedName] : null;

    if (!expiryInfo || !expiryInfo.current) {
      console.log(`  ⚠️  ${String(symbol).toUpperCase()}: No future expiry in master → skipped`);
      continue;
    }

    const upperSymbol = mappedName;
    console.log(`\n  Processing ${upperSymbol} (requested ${symbol})`);
    console.log(`    Current expiry: ${expiryInfo.current}`);
    console.log(`    Next expiry   : ${expiryInfo.next}`);
    console.log(`    All expiries  : ${expiryInfo.all.join(', ')}`);

    const targets = [{ expiry: expiryInfo.current, type: 'CURRENT' }];

    for (const t of targets) {
      const allContracts = master.filter(
        (item) =>
          item.exch_seg === 'NFO' &&
          item.instrumenttype === 'OPTSTK' &&
          item.name === upperSymbol &&
          item.expiry === t.expiry
      );

      console.log(`    ${t.type} (${t.expiry}): found ${allContracts.length} total contracts`);

      let contracts = allContracts.map((item) => ({
        token: item.token,
        symbol: item.symbol,
        name: item.name,
        expiry: item.expiry,
        strike: parseFloat(item.strike) / 100,
        optionType: String(item.symbol).endsWith('CE') ? 'CE' : 'PE',
        lotsize: parseInt(item.lotsize, 10) || 1,
        expiryType: t.type
      }));

      const currentPrice =
        currentPrices[upperSymbol] ||
        currentPrices[symbol] ||
        currentPrices[String(symbol).toUpperCase()];

      if (!currentPrice) {
        console.log(`    ⚠️  No LTP for ${upperSymbol} → skip`);
        continue;
      }

      contracts = filterNearATM(contracts, currentPrice, 2);
      console.log(`    → Adding ${contracts.length} contracts after Near-ATM filter`);
      result.push(...contracts);
    }
  }

  console.log(`\n✅ [Instrument] Total Near-ATM contracts ready: ${result.length}`);
  return result;
}

async function getEquityToken(symbol) {
  const master = await loadMaster();
  const names = lookupNames(symbol);

  const item = master.find(
    (s) =>
      s.exch_seg === 'NSE' &&
      s.instrumenttype === '' &&
      names.some((n) => s.symbol === `${n}-EQ` || s.symbol === n || s.name === n)
  );

  if (item) {
    console.log(`   [EquityToken] ${symbol} → ${item.token} (${item.symbol})`);
    return item.token;
  }

  console.warn(`   [EquityToken] ${symbol} → NOT FOUND`);
  return null;
}

async function getOptionInstruments(symbols, expiry) {
  const master = await loadMaster();
  const wanted = symbols.flatMap((s) => lookupNames(s));

  return master
    .filter(
      (item) =>
        item.exch_seg === 'NFO' &&
        item.instrumenttype === 'OPTSTK' &&
        item.expiry === expiry &&
        wanted.includes(item.name)
    )
    .map((item) => ({
      token: item.token,
      symbol: item.symbol,
      name: item.name,
      expiry: item.expiry,
      strike: parseFloat(item.strike) / 100,
      optionType: String(item.symbol).endsWith('CE') ? 'CE' : 'PE',
      lotsize: parseInt(item.lotsize, 10) || 1
    }));
}

module.exports = {
  loadMaster,
  buildCurrentNextExpiryMap,
  getCurrentAndNextExpiry,
  getCurrentAndNextContracts,
  getOptionInstruments,
  filterNearATM,
  getEquityToken
};