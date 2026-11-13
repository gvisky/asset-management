/* Depreciation & book value (straight-line).

   Period: 5 years for computers / IT equipment (company rule, confirmed by Finance). Vietnam's Circular
   45/2013/TT-BTC Annex 1 puts management electronic / IT equipment in a 3–8 year frame, so 5 is within it.
   IT admins can set the years per country (app_meta "depreciation_years", e.g. {"default":5,"Thailand":5}).

   Cost is stored as text ("18,992,364 VND", "1,200 USD", "0"); parseCost() reads the amount + currency. */

const { getMeta, setMeta } = require('../db/database');

const DEFAULT_YEARS = 5;
const DEFAULT_CURRENCY = { Vietnam: 'VND', Thailand: 'THB', Malaysia: 'MYR', China: 'CNY' };

/** "18,992,364 VND" → { amount: 18992364, currency: 'VND' }; null if no amount. */
function parseCost(text, country) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return null;
  let currency = '';
  if (/vn[dđ]|₫|\bđ\b|dong/i.test(s)) currency = 'VND';
  else if (/usd|\$/i.test(s)) currency = 'USD';
  else if (/thb|฿|baht/i.test(s)) currency = 'THB';
  else if (/myr|\brm\b|ringgit/i.test(s)) currency = 'MYR';
  else if (/eur|€/i.test(s)) currency = 'EUR';
  else if (/cny|rmb|yuan|¥/i.test(s)) currency = 'CNY';
  const m = s.replace(/\s/g, '').match(/[\d.,]+/);
  if (!m) return null;
  let num = m[0];
  const lastDot = num.lastIndexOf('.'), lastComma = num.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // both: the last one is the decimal separator
    num = lastDot > lastComma ? num.replace(/,/g, '') : num.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    num = /^\d{1,3}(,\d{3})+$/.test(num) ? num.replace(/,/g, '') : num.replace(',', '.');
  } else if (lastDot >= 0) {
    // "1.200.000" (thousands) vs "1200.50" (decimal)
    if (/^\d{1,3}(\.\d{3})+$/.test(num) && (num.split('.').length > 2 || currency === 'VND')) num = num.replace(/\./g, '');
  }
  const amount = Number(num);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, currency: currency || DEFAULT_CURRENCY[country] || '' };
}

async function getYearsMap() {
  let m = {};
  try { m = JSON.parse((await getMeta('depreciation_years')) || '{}') || {}; } catch { m = {}; }
  if (!Number(m.default)) m.default = DEFAULT_YEARS;
  return m;
}
async function setYearsMap(map) {
  const clean = {};
  for (const [k, v] of Object.entries(map || {})) { const n = Number(v); if (n >= 1 && n <= 20) clean[String(k).slice(0, 40)] = Math.round(n * 10) / 10; }
  if (!clean.default) clean.default = DEFAULT_YEARS;
  await setMeta('depreciation_years', JSON.stringify(clean));
  return clean;
}
const yearsFor = (map, country) => Number(map[country]) || Number(map.default) || DEFAULT_YEARS;

/**
 * Straight-line from the purchase date: book value = cost × (1 − age / years), never below 0.
 * → { years, cost, currency, ageYears, bookValue, depreciated, pctLeft, fully } or null (no cost / date).
 */
function depreciation(asset, map) {
  const c = parseCost(asset.cost, asset.country);
  const t = Date.parse(String(asset.purchase_date || '').slice(0, 10));
  if (!c || !Number.isFinite(t)) return null;
  const years = yearsFor(map || {}, asset.country);
  const ageYears = Math.max(0, (Date.now() - t) / (365.25 * 86400000));
  const left = Math.max(0, 1 - ageYears / years);
  const bookValue = Math.round(c.amount * left);
  return { years, cost: c.amount, currency: c.currency, ageYears: Math.round(ageYears * 10) / 10,
    bookValue, depreciated: Math.round(c.amount - bookValue), pctLeft: Math.round(left * 1000) / 10, fully: left === 0,
    endDate: new Date(t + years * 365.25 * 86400000).toISOString().slice(0, 10) };
}

module.exports = { DEFAULT_YEARS, parseCost, depreciation, getYearsMap, setYearsMap, yearsFor };
