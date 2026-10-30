/* Country scope of the signed-in user.
   users.country is NULL/'' for global users (see every country), or a
   comma-separated list for users who manage one or more countries
   ("Vietnam" or "Vietnam,Thailand"). */

// Parse a stored country value into a list ([] = global).
function parseCountries(v) {
  return String(v || '').split(',').map(s => s.trim()).filter(Boolean);
}

// null = global (no restriction), else the list of allowed countries.
function scopeList(req) {
  const list = parseCountries(req && req.user && req.user.country);
  return list.length ? list : null;
}

// Is this country visible / editable for the user?
function inScope(req, country) {
  const list = scopeList(req);
  return !list || list.includes(country);
}

// SQL condition for a country column: user scope, optionally narrowed by a
// requested country (?country=). Returns { clause, params } or { clause: null }.
function countrySql(req, col = 'country', requested = req && req.query && req.query.country) {
  const list = scopeList(req);
  if (requested) {
    if (list && !list.includes(requested)) return { clause: '1 = 0', params: [] };   // outside scope → nothing
    return { clause: `${col} = ?`, params: [requested] };
  }
  if (list) return { clause: `${col} IN (${list.map(() => '?').join(', ')})`, params: list };
  return { clause: null, params: [] };
}

// The one country a single-country user is fixed to (null if global or several).
function singleScope(req) {
  const list = scopeList(req);
  return list && list.length === 1 ? list[0] : null;
}

// Country to store for a create/update: a requested country the user may use,
// else the user's only country, else the fallback.
function resolveScopedCountry(req, requested, fallback) {
  const list = scopeList(req);
  if (list) return list.includes(requested) ? requested : list[0];
  return requested || fallback;
}

module.exports = { parseCountries, scopeList, inScope, countrySql, singleScope, resolveScopedCountry };
