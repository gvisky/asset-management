/* All countries known to the app: the 3 core countries plus every country found
   in User Inventory, Devices, Assets and Servers. Cached for a minute. */
const { all } = require('../db/database');
const { CORE_COUNTRIES, sortCountries } = require('./countries');

let cache = null, cachedAt = 0;

async function knownCountries() {
  if (cache && Date.now() - cachedAt < 60 * 1000) return cache;
  const lists = [];
  for (const sql of [
    "SELECT DISTINCT country AS c FROM personnel WHERE country <> ''",
    "SELECT DISTINCT country AS c FROM assets WHERE country <> ''",
    "SELECT DISTINCT country AS c FROM servers WHERE country <> ''",
    "SELECT DISTINCT country AS c FROM devices WHERE country <> ''",
  ]) {
    try { lists.push(...(await all(sql)).map(r => r.c)); } catch (e) { /* table may not exist yet */ }
  }
  cache = sortCountries([...CORE_COUNTRIES, ...lists]);
  cachedAt = Date.now();
  return cache;
}
function resetCountryCache() { cache = null; }

module.exports = { knownCountries, resetCountryCache };
