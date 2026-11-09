/* Active Directory user list → User Inventory.

   The AD export (xlsx / csv) has: SAM Account Name, Display Name, Manager, OU Name, Last Logon Time.
     OU "HAYAT/VN/HCMC/Users"      → a person in Vietnam (MLY = Malaysia, TH = Thailand, VN = Vietnam, CN = China)
     OU "HAYAT/VN/HCMC/Resources"  → shared mailbox / email group — not a person, skipped
     Last Logon "0"                → never logged on

   Matching an AD account to a User Inventory person, in this order:
     1. the AD account remembered from an earlier upload (personnel.ad_sam)
     2. the email before @ = the AD account (the usual rule: AD Name = email local-part)
     3. the same name (ignoring accents, word order and "(VN SAL)"-style tags) in the same country,
        when exactly one person has it — AD cuts long account names to 20 characters,
        e.g. RTriratcharta = RTriratchartapong@…
   "Doubles": a person found by rule 1/2 who ALSO has a second row with the same name (and an
   email that isn't any AD account) → proposed merge of the second row into the first. */

const XLSX = require('xlsx');
const { normCountry } = require('./countries');

const OU_COUNTRY = { VN: 'Vietnam', TH: 'Thailand', MLY: 'Malaysia', MY: 'Malaysia', CN: 'China' };
const lc = (v) => String(v == null ? '' : v).trim().toLowerCase();
const localPart = (email) => lc(String(email || '').split('@')[0]);

// Name key: no accents, no "(…)" tags, words sorted ("Le Kim Ai" = "Ai Le Kim").
function nameKey(s) {
  return String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}

// "(VN SAL)", "(MKT)" … — two names with different tags are different people ("Chi Nguyen (MKT)" ≠ "Chi Nguyen (SC)").
const tagOf = (s) => { const m = String(s || '').match(/\(([^)]*)\)/); return m ? m[1].trim().toLowerCase().replace(/\s+/g, ' ') : ''; };
const tagsClash = (a, b) => { const x = tagOf(a), y = tagOf(b); return !!(x && y && x !== y); };

// Shared / function accounts that sit in the Users OU (TBP05, Laboratory, VN Electrical, HR …).
const SHARED_WORDS = /\b(vn|hk|th|my|mly|qc|iqc|hr|it|invoice|reception|electrical|mechanical\d*|laboratory|lab|support|admin|team|group|scan|scanner|printer|meeting|room|union|weighbridge|technician|vietnam|thailand|malaysia|uretim|lotion|careers?|contact|info|test|service|shared)\b/i;
function looksShared(sam, name) {
  const n = String(name || '').replace(/\(.*?\)/g, ' ').trim();
  if (!n || lc(n) === lc(sam)) return true;
  if (!/\s/.test(n)) return true;               // one word: "Lotion", "vnrealwear", "TBP05"
  if (/\d/.test(n)) return true;                // "VN Mechanical01"
  return SHARED_WORDS.test(n);
}

const pad = (n) => String(n).padStart(2, '0');
// Last logon → "YYYY-MM-DD HH:MM" (as exported, office local time), null = never / unknown.
function parseLogon(v) {
  if (v == null || v === '' || v === 0 || v === '0' || v === '-') return null;
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d || d.y < 1990) return null;
    return `${d.y}-${pad(d.m)}-${pad(d.d)} ${pad(d.H)}:${pad(d.M)}`;
  }
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/);           // 11/6/26 4:17 (M/D/Y)
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${pad(m[1])}-${pad(m[2])} ${pad(m[4] || 0)}:${pad(m[5] || 0)}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4] || '00'}:${m[5] || '00'}`;
  return null;
}

/** Read the uploaded file (Buffer) → [{ sam, name, manager, ou, country, resource, lastLogon, never }]. */
function parseAdFile(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (!grid.length) return [];
  // Find columns by header name, else A–E.
  const head = grid[0].map(h => lc(h));
  const col = (re, fallback) => { const i = head.findIndex(h => re.test(h)); return i >= 0 ? i : fallback; };
  const C = { sam: col(/sam|account/, 0), name: col(/display/, 1), manager: col(/manager|report/, 2),
              ou: col(/\bou\b|organi[sz]ational|ou name/, 3), logon: col(/logon|login/, 4) };
  const hasHeader = head.some(h => /sam|display|manager/.test(h));
  const out = [];
  for (const r of grid.slice(hasHeader ? 1 : 0)) {
    const sam = String(r[C.sam] == null ? '' : r[C.sam]).trim();
    if (!sam) continue;
    const ou = String(r[C.ou] || '').trim();
    const parts = ou.split('/').map(s => s.trim());
    const code = (parts[0] && /hayat/i.test(parts[0]) ? parts[1] : parts[0]) || '';
    const country = OU_COUNTRY[code.toUpperCase()] || normCountry(code) || '';
    const rawLogon = r[C.logon];
    const lastLogon = parseLogon(rawLogon);
    let manager = String(r[C.manager] || '').trim();
    if (manager === '-') manager = '';
    out.push({ sam, name: String(r[C.name] || '').trim() || sam, manager, ou, country,
      resource: /\/resources?(\/|$)/i.test(ou), lastLogon, never: !lastLogon });
  }
  return out;
}

/**
 * Work out what an upload would do (nothing is written here).
 * people: all personnel rows { id, email, display_name, country, touched, ad_sam, user_type, status, … }
 */
function planAdImport(adRows, people) {
  const users = adRows.filter(r => !r.resource);
  const resources = adRows.filter(r => r.resource);
  const adSams = new Set(users.map(r => lc(r.sam)));
  const nameCountInAd = users.reduce((m, r) => { const k = nameKey(r.name); m.set(k, (m.get(k) || 0) + 1); return m; }, new Map());

  const bySam = new Map(), byLocal = new Map(), byName = new Map();
  for (const p of people) {
    if (p.ad_sam) bySam.set(lc(p.ad_sam), p);
    const l = localPart(p.email); if (l && !byLocal.has(l)) byLocal.set(l, p);
    const k = nameKey(p.display_name); if (k) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p); }
  }

  const used = new Set();                 // person ids already claimed by an AD account
  const matched = [], byNameMatch = [], fresh = [], countryDiffs = [];
  // Pass 1: exact matches (remembered account, then email).
  const pending = [];
  for (const r of users) {
    const p = bySam.get(lc(r.sam)) || byLocal.get(lc(r.sam));
    if (p && !used.has(p.id)) { used.add(p.id); matched.push({ r, p, how: bySam.get(lc(r.sam)) ? 'account' : 'email' }); }
    else pending.push(r);
  }
  // Pass 2: same name, same country, exactly one free candidate, name unique in AD.
  for (const r of pending) {
    const k = nameKey(r.name);
    const cands = (byName.get(k) || []).filter(p => !used.has(p.id) && !adSams.has(localPart(p.email))
      && (!r.country || !p.country || p.country === r.country) && !tagsClash(r.name, p.display_name));
    if (k && nameCountInAd.get(k) === 1 && cands.length === 1) {
      used.add(cands[0].id);
      const m = { r, p: cands[0], how: 'name' };
      matched.push(m); byNameMatch.push(m);
    } else {
      fresh.push({ ...r, shared: looksShared(r.sam, r.name) });
    }
  }
  // Doubles: another row with the same name + country that no AD account claims → merge into the matched row.
  const merges = [];
  for (const m of matched) {
    const k = nameKey(m.p.display_name || m.r.name);
    if (!k || nameCountInAd.get(nameKey(m.r.name)) > 1) continue;
    for (const d of (byName.get(k) || [])) {
      if (d.id === m.p.id || used.has(d.id) || adSams.has(localPart(d.email))) continue;
      if (d.country && m.p.country && d.country !== m.p.country) continue;
      if (tagsClash(d.display_name, m.p.display_name) || tagsClash(d.display_name, m.r.name)) continue;
      used.add(d.id);
      merges.push({ keep: m.p, drop: d, sam: m.r.sam });
    }
  }
  for (const m of matched) {
    if (m.r.country && m.p.country && m.r.country !== m.p.country) countryDiffs.push({ id: m.p.id, name: m.p.display_name, inventory: m.p.country, ad: m.r.country, sam: m.r.sam });
  }
  // People in the countries this file covers that no AD account matched.
  const covered = new Set(users.map(r => r.country).filter(Boolean));
  const notInAd = people.filter(p => !used.has(p.id) && covered.has(p.country) && p.status !== 'deleted');

  return { users, resources, matched, byNameMatch, fresh, merges, countryDiffs, notInAd, covered: [...covered] };
}

module.exports = { parseAdFile, planAdImport, parseLogon, looksShared, nameKey };
