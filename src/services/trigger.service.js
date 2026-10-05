// src/services/trigger.service.js
const axios = require('axios');
const tokenService = require('./token.service');
const instrumentService = require('./instrument.service');
const OptionTrigger = require('../models/OptionTrigger');
const { getSector } = require('../config/sectors');
const ScanRun = require('../models/ScanRun');

const THRESHOLD = 5;
let isJobRunning = false;
// ==============================================================
// Helper: Angel One headers
// ==============================================================
async function getHeaders() {
  console.log('   🔑 Requesting valid JWT...');
  const jwtToken = await tokenService.getValidToken();
  console.log('   🔑 JWT ready');
  return {
    Authorization: `Bearer ${jwtToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '127.0.0.1',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-PrivateKey': process.env.ANGEL_API_KEY
  };
}

function getISTParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute')
  };
}

function isMarketOpenIST(date = new Date()) {
  const { hour, minute } = getISTParts(date);
  const mins = hour * 60 + minute;
  // 09:15 → 15:30 IST
  return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
}

function formatISTDateTime(date) {
  const { year, month, day, hour, minute } = getISTParts(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
}

function formatISTSessionDay(date, hour, minute) {
  const { year, month, day } = getISTParts(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
}

// ==============================================================
// Get Equity LTP
// ==============================================================
async function getEquityLTP(symbols) {
  console.log('\n========== STEP 1: UNDERLYING LTP ==========');
  console.log('Symbols to fetch:', symbols.join(', '));

  const headers = await getHeaders();
  const tokenBySymbol = {};
  const tokens = [];

  for (const symbol of symbols) {
    const token = await instrumentService.getEquityToken(symbol);
    if (token) {
      const t = String(token);
      tokens.push(t);
      tokenBySymbol[t] = symbol.toUpperCase();
      console.log(`   [EquityToken] ${symbol} → ${t}`);
    } else {
      console.log(`   [EquityToken] ${symbol} → NOT FOUND`);
    }
  }

  console.log(`Equity tokens collected: ${tokens.length}`);
  if (!tokens.length) return {};

  // Angel often limits batch size; chunk by 50
  const priceMap = {};
  const allFetched = [];
  const allUnfetched = [];

  for (let i = 0; i < tokens.length; i += 50) {
    const chunk = tokens.slice(i, i + 50);
    console.log(`Calling Quote API (LTP) chunk ${i / 50 + 1}, size=${chunk.length}...`);

    const start = Date.now();
    let response;
    try {
      response = await axios.post(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/',
        {
          mode: 'LTP',
          exchangeTokens: { NSE: chunk } // strings only
        },
        { headers, timeout: 30000 }
      );
    } catch (err) {
      console.error(
        'Quote HTTP error:',
        err.response?.status,
        err.response?.data || err.message
      );
      continue;
    }

    const body = response.data;
    console.log(
      `Quote responded in ${Date.now() - start}ms | status=${body?.status} | message=${body?.message} | errorcode=${body?.errorcode}`
    );
    console.log('Top keys:', Object.keys(body || {}));
    if (body?.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
      console.log('data keys:', Object.keys(body.data));
    }

    const data = body?.data;
    let fetched = [];
    if (Array.isArray(data?.fetched)) fetched = data.fetched;
    else if (Array.isArray(data)) fetched = data;
    else if (Array.isArray(body?.fetched)) fetched = body.fetched;

    const unfetched = Array.isArray(data?.unfetched) ? data.unfetched : [];
    allFetched.push(...fetched);
    allUnfetched.push(...unfetched);

    console.log(`fetched=${fetched.length} unfetched=${unfetched.length}`);
    if (fetched[0]) {
      console.log('sample fetched:', JSON.stringify(fetched[0]).slice(0, 250));
    }
    if (unfetched[0]) {
      console.log('sample unfetched:', JSON.stringify(unfetched[0]).slice(0, 250));
    }

    for (const row of fetched) {
      const token = String(row.symbolToken ?? row.symboltoken ?? row.token ?? '');
      const ltp = parseFloat(row.ltp ?? row.LTP ?? row.last_price ?? 0);
      const sym =
        tokenBySymbol[token] ||
        String(row.tradingSymbol || row.tradingsymbol || row.symbol || '')
          .replace(/-EQ$/i, '')
          .toUpperCase();

      if (sym && ltp > 0) {
        priceMap[sym] = ltp;
        console.log(`   ${sym}: ₹${ltp}`);
      }
    }
  }

  console.log(
    `Quote totals → fetched=${allFetched.length} unfetched=${allUnfetched.length}`
  );
  console.log(`Price map ready for ${Object.keys(priceMap).length} symbols`);
  return priceMap;
}

// ==============================================================
// Fetch live quotes (batch of 50)
// ==============================================================
async function getQuotes(tokens) {
  console.log('\n========== STEP 3: LIVE QUOTES ==========');
  console.log(`Total option tokens: ${tokens.length}`);

  const headers = await getHeaders();
  const results = [];
  const totalBatches = Math.ceil(tokens.length / 50);

  for (let i = 0; i < tokens.length; i += 50) {
    const batchNo = Math.floor(i / 50) + 1;
    const chunk = tokens.slice(i, i + 50);

    console.log(`   Batch ${batchNo}/${totalBatches} → ${chunk.length} tokens`);

    const start = Date.now();
    const response = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/',
      {
        mode: 'FULL',
        exchangeTokens: { NFO: chunk }
      },
      { headers }
    );

    const fetched = response.data?.data?.fetched || [];
    console.log(`   ← Received ${fetched.length} quotes (${Date.now() - start}ms)`);
    results.push(...fetched);

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`Total quotes collected: ${results.length}`);
  return results;
}
async function getFifteenMinCandles(token, meta = {}) {
  const headers = await getHeaders();
  const now = new Date();
  const label = meta.name
    ? `${meta.name} ${meta.strike} ${meta.optionType}`
    : token;

  let fromStr;
  let toStr;

  if (meta.from && meta.to) {
    fromStr = meta.from;
    toStr = meta.to;
    console.log(`   ⏰ Bucket window ${fromStr} → ${toStr}`);
  } else if (isMarketOpenIST(now)) {
    const fromDate = new Date(now.getTime() - 20 * 60 * 1000);
    fromStr = formatISTDateTime(fromDate);
    toStr = formatISTDateTime(now);
    console.log('   ⏰ Market OPEN (IST) → using last 20 minutes');
  } else {
    fromStr = formatISTSessionDay(now, 9, 15);
    toStr = formatISTSessionDay(now, 15, 30);
    console.log('   ⏰ Market CLOSED (IST) → using full day 09:15 – 15:30');
  }

  console.log(`   🕯️  Candle → ${label}`);
  console.log(`      Range  : ${fromStr} → ${toStr}`);

  try {
    const response = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData',
      {
        exchange: 'NFO',
        symboltoken: String(token),
        interval: 'ONE_MINUTE',
        fromdate: fromStr,
        todate: toStr
      },
      { headers }
    );

    const candles = response.data?.data || [];
    // Bucket request is already the window. Do not slice last 15 sparse prints.
    const used = meta.from && meta.to ? candles : candles.slice(-15);
    const closes = used.map((c) => parseFloat(c[4]));
    const startTime = used.length ? new Date(used[0][0]) : null;
    const endTime = used.length ? new Date(used[used.length - 1][0]) : null;
    const windowHigh = used.length
      ? used.reduce((m, c) => Math.max(m, parseFloat(c[2])), 0)
      : null;
    const windowLow = used.length
      ? used.reduce((m, c) => Math.min(m, parseFloat(c[3])), Infinity)
      : null;

    console.log(
      `   ✓ ${label} → ${candles.length} candles, using ${closes.length} closes`
    );
    if (startTime && endTime) {
      console.log(
        `     Window: ${startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} → ${endTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
      );
    }

    return { closes, startTime, endTime, windowHigh, windowLow };
  } catch (err) {
    console.warn(
      `   ✗ Candle FAILED [${label}]:`,
      err.response?.status,
      err.response?.data?.message || err.message
    );
    return { closes: [], startTime: null, endTime: null, windowHigh: null, windowLow: null };
  }
}

function dteFromExpiry(expiry, on = new Date()) {
  const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  const m = String(expiry).toUpperCase().match(/^(\d{1,2})([A-Z]{3})(\d{4})$/);
  if (!m) return null;
  const exp = Date.UTC(+m[3], months[m[2]], +m[1]);
  const ist = new Date(on.getTime() + 5.5 * 60 * 60 * 1000);
  const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
  return Math.round((exp - today) / 86400000);
}

function windowIndexFrom(start) {
  if (!start) return null;
  const p = getISTParts(start);
  const mins = p.hour * 60 + p.minute;
  return Math.max(0, Math.floor((mins - (9 * 60 + 15)) / 15));
}

function bestDepth(depth) {
  const bid = depth?.buy?.[0]?.price;
  const ask = depth?.sell?.[0]?.price;
  const mid = bid && ask ? (bid + ask) / 2 : null;
  return {
    bid: bid || null,
    ask: ask || null,
    spreadPct: mid ? Number((((ask - bid) / mid) * 100).toFixed(2)) : null
  };
}

/// ==============================================================
// Build final trigger objects
// ==============================================================
async function buildTriggers(symbols) {
  const THRESHOLD = 5;

  console.log('\n\n######################################################');
  console.log('🚀  TRIGGER JOB STARTED');
  console.log(`Time     : ${new Date().toLocaleString()}`);
  console.log(`Symbols  : ${symbols.join(', ')}`);
  console.log('######################################################');

  // Step 1
  const priceMap = await getEquityLTP(symbols);

  // Step 2
  console.log('\n========== STEP 2: NEAR-ATM CONTRACTS ==========');
  let contracts = await instrumentService.getCurrentAndNextContracts(symbols, priceMap);

  // MVP: only CURRENT expiry
  contracts = contracts.filter((c) => c.expiryType === 'CURRENT');
  console.log(`\nNear-ATM CURRENT contracts: ${contracts.length}`);

  if (contracts.length === 0) {
    console.log('No contracts to process. Exiting.');
    return [];
  }

  console.log(`Processing ${contracts.length} contracts`);

  // Step 3
  const tokens = contracts.map((c) => c.token);
  const quotes = await getQuotes(tokens);

  const quoteMap = {};
  quotes.forEach((q) => {
    quoteMap[q.symbolToken] = q;
  });
  console.log(`Quote map built with ${Object.keys(quoteMap).length} entries`);

  const now = new Date();
  const triggers = [];
  let successCount = 0;
  let skipCount = 0;
  let failCount = 0;
  let belowThresholdCount = 0;

  // Step 4
  console.log('\n========== STEP 4: CANDLES + TRIGGER BUILD ==========');
  console.log(`Will process ${contracts.length} contracts (1 sec delay each)\n`);

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];
    console.log(
      `--- [${i + 1}/${contracts.length}] ${contract.name} ${contract.strike} ${contract.optionType} (${contract.expiryType}) ---`
    );

    const q = quoteMap[contract.token];

    if (!q || !q.ltp) {
      console.log('   ✗ No quote/LTP → skip');
      skipCount++;
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    console.log(`   LTP: ${q.ltp} | Volume: ${q.tradeVolume || 0}`);

    // getFifteenMinCandles must return: { closes, startTime, endTime }
    const candleData = await getFifteenMinCandles(contract.token, {
      name: contract.name,
      strike: contract.strike,
      optionType: contract.optionType
    });

    // Always wait (rate-limit protection)
    console.log('   ⏳ Waiting 1500ms...');
    await new Promise((r) => setTimeout(r, 1500));

    const priceSequence = candleData.closes || [];

    if (priceSequence.length < 5) {
      console.log(`   ✗ Insufficient candles (${priceSequence.length}) → skip`);
      failCount++;
      continue;
    }

    const triggerStartPrice = priceSequence[0];
    const triggerEndPrice = priceSequence[priceSequence.length - 1];
    const changePercent =
      ((triggerEndPrice - triggerStartPrice) / triggerStartPrice) * 100;

    console.log(`   ✓ Prices ready | Change: ${changePercent.toFixed(2)}%`);

    if (Math.abs(changePercent) < THRESHOLD) {
      console.log(`   ✗ Below threshold (${changePercent.toFixed(2)}%) → skip`);
      belowThresholdCount++;
      continue;
    }

    // Times come from actual candle window
    const triggerStartTime =
      candleData.startTime || new Date(now.getTime() - 15 * 60 * 1000);
    const triggerEndTime = candleData.endTime || now;
    const spot = priceMap[contract.name] || null;
    const book = bestDepth(q.depth);
    const moneynessPct = spot
      ? Number((((contract.strike - spot) / spot) * 100).toFixed(2))
      : null;
    console.log(
      `   ✓ ABOVE THRESHOLD | ${triggerStartTime.toLocaleTimeString()} → ${triggerEndTime.toLocaleTimeString()} | ${changePercent.toFixed(2)}%`
    );

    
    triggers.push({
      instrumentName: contract.name,
      symbol: contract.name,
      instrumentSector: getSector(contract.name),
      volume: q.tradeVolume || 0,
      expiry: contract.expiry,
      strikePrice: contract.strike,
      optionType: contract.optionType,
      generatedTime: now,
      triggerStartTime,
      triggerEndTime,
      triggerStartPrice,
      triggerEndPrice,
      changePercent: Number(changePercent.toFixed(2)),
      priceSequence,

      token: String(contract.token),
      lotSize: contract.lotsize || 1,
      underlyingPrice: spot,
      moneynessPct,
      dte: dteFromExpiry(contract.expiry, now),
      oi: q.opnInterest || 0,
      bid: book.bid,
      ask: book.ask,
      spreadPct: book.spreadPct,
      totBuyQuan: q.totBuyQuan || 0,
      totSellQuan: q.totSellQuan || 0,
      dayOpen: q.open || null,
      dayHigh: q.high || null,
      dayLow: q.low || null,
      windowHigh: candleData.windowHigh || null,
      windowLow: candleData.windowLow || null,
      sessionDate: dayIST(triggerEndTime),
      windowIndex: windowIndexFrom(triggerStartTime)
    });

    successCount++;
  }

  console.log('\n======================================================');
  console.log(`✅ BUILD SUMMARY (Threshold ±${THRESHOLD}%)`);
  console.log(`   Success (saved)     : ${successCount}`);
  console.log(`   Below threshold     : ${belowThresholdCount}`);
  console.log(`   Skipped (no quote)  : ${skipCount}`);
  console.log(`   Failed (no candles) : ${failCount}`);
  console.log(`   Total triggers      : ${triggers.length}`);
  console.log('======================================================\n');

  return triggers;
}

// ==============================================================
// Save to MongoDB
// ==============================================================
async function saveTriggers(triggers) {
  console.log('========== SAVING TO MONGODB ==========');
  if (!triggers || triggers.length === 0) {
    console.log('Nothing to save');
    return [];
  }

  const result = await OptionTrigger.insertMany(triggers);
  console.log(`✅ Saved ${result.length} documents to MongoDB`);
  return result;
}

function bucketWindowIST(now = new Date(), bucket = 'intraday') {
  const p = getISTParts(now);
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${p.year}-${pad(p.month)}-${pad(p.day)}`;

  if (bucket === 'close') {
    return { bucket, from: `${day} 15:00`, to: `${day} 15:30` };
  }

  // job starts at :32 or :00/:30 — store the half-hour that just finished
  const endMin = p.minute >= 32 ? 30 : p.minute >= 30 ? 30 : 0;
  let endH = p.hour;
  let startH = endH;
  let startMin = endMin === 30 ? 0 : 30;
  if (endMin === 0) {
    startH = endH - 1;
    startMin = 30;
  }
  // 09:32 stores 09:15–09:30, not 09:00–09:30
  if (endH === 9 && endMin === 30) {
    return { bucket, from: `${day} 09:15`, to: `${day} 09:30` };
  }

  return {
    bucket,
    from: `${day} ${pad(startH)}:${pad(startMin)}`,
    to: `${day} ${pad(endH)}:${pad(endMin)}`
  };
}

// ==============================================================
// Main job
// ==============================================================
function dayIST(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
}

async function runTriggerJob(symbols, opts = {}) {
  const bucket = opts.bucket || 'intraday';
  const window = bucketWindowIST(new Date(), bucket);

  if (isJobRunning) {
    console.log('⏸️  Previous job still running — skipping this cron');
    await ScanRun.create({
      startedAt: new Date(),
      finishedAt: new Date(),
      status: 'skipped',
      symbolsCount: symbols?.length || 0,
      triggersFound: 0,
      dayIST: dayIST(),
      bucket: window.bucket,
      windowFrom: window.from,
      windowTo: window.to
    });
    return [];
  }

  isJobRunning = true;
  const startedAt = new Date();
  console.log(`📅 Bucket ${window.bucket} | ${window.from} → ${window.to}`);

  const run = await ScanRun.create({
    startedAt,
    status: 'running',
    symbolsCount: symbols?.length || 0,
    dayIST: dayIST(startedAt),
    bucket: window.bucket,
    windowFrom: window.from,
    windowTo: window.to
  });

  try {
    const triggers = await buildTriggers(symbols, window);
    await saveTriggers(triggers);
    run.status = 'success';
    run.triggersFound = triggers.length;
    run.finishedAt = new Date();
    await run.save();
    console.log('########## JOB COMPLETED SUCCESSFULLY ##########\n');
    return triggers;
  } catch (err) {
    run.status = 'failed';
    run.error = err.message;
    run.finishedAt = new Date();
    await run.save();
    console.error('########## JOB FAILED ##########');
    console.error(err.message);
    throw err;
  } finally {
    isJobRunning = false;
  }
}

module.exports = {
  buildTriggers,
  saveTriggers,
  runTriggerJob
};