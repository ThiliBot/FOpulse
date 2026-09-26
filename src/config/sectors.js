// src/config/sectors.js
const SECTOR_BY_SYMBOL = {
  // Banking & Financials
  AXISBANK: 'Banking',
  HDFCBANK: 'Banking',
  ICICIBANK: 'Banking',
  INDUSINDBK: 'Banking',
  KOTAKBANK: 'Banking',
  SBIN: 'Banking',
  BAJFINANCE: 'Financial Services',
  BAJAJFINSV: 'Financial Services',
  HDFCLIFE: 'Financial Services',
  SBILIFE: 'Financial Services',
  SHRIRAMFIN: 'Financial Services',

  // IT
  HCLTECH: 'IT',
  INFY: 'IT',
  LTM: 'IT',
  TCS: 'IT',
  TECHM: 'IT',
  WIPRO: 'IT',

  // Auto
  'BAJAJ-AUTO': 'Auto',
  EICHERMOT: 'Auto',
  HEROMOTOCO: 'Auto',
  'M&M': 'Auto',
  MARUTI: 'Auto',
  TMCV: 'Auto',

  // Pharma & Healthcare
  APOLLOHOSP: 'Pharma & Healthcare',
  CIPLA: 'Pharma & Healthcare',
  DIVISLAB: 'Pharma & Healthcare',
  DRREDDY: 'Pharma & Healthcare',
  SUNPHARMA: 'Pharma & Healthcare',

  // Energy / Oil & Gas / Power
  BPCL: 'Energy',
  COALINDIA: 'Energy',
  NTPC: 'Energy',
  ONGC: 'Energy',
  POWERGRID: 'Energy',
  RELIANCE: 'Energy',

  // Metals
  HINDALCO: 'Metals',
  JSWSTEEL: 'Metals',
  TATASTEEL: 'Metals',

  // FMCG / Consumer
  ASIANPAINT: 'FMCG & Consumer',
  BRITANNIA: 'FMCG & Consumer',
  HINDUNILVR: 'FMCG & Consumer',
  ITC: 'FMCG & Consumer',
  NESTLEIND: 'FMCG & Consumer',
  TATACONSUM: 'FMCG & Consumer',
  TITAN: 'FMCG & Consumer',

  // Infra / Capital Goods / Conglomerate
  ADANIENT: 'Infrastructure',
  ADANIPORTS: 'Infrastructure',
  BEL: 'Capital Goods',
  GRASIM: 'Conglomerate',
  LT: 'Infrastructure',
  ULTRACEMCO: 'Cement',

  // Telecom
  BHARTIARTL: 'Telecom'
};

function getSector(symbol) {
  if (!symbol) return 'Others';
  const key = String(symbol).toUpperCase();
  return SECTOR_BY_SYMBOL[key] || 'Others';
}

module.exports = {
  SECTOR_BY_SYMBOL,
  getSector
};