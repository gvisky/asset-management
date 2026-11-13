/* "My devices" — staff check and confirm the assets registered to them.

   IT admin (User Inventory → 📨 on a person) makes a personal link and copies a ready message (with a button)
   to send to that person's work email. The link holds a random secret (only its SHA-256 hash is stored),
   works for LINK_DAYS days, and a new link replaces the old one.
   The person opens /my-devices.html#t=<secret>; the page asks for their work email. Only when it equals
   an email on our record (User Inventory: <AD name>@hayat.com.tr, or the second "market" email from the
   AD list, personnel.ad_email) are the devices shown — 5 wrong emails lock the link.
   They tick "I have it" / "Not with me" per asset and press Confirm — the checked work email is the
   signature: one row per asset in asset_confirmations (time, IP, browser), the audit log, and an IT alert
   when something is "not with me".
   Phones / tablets (Intune devices of the person, iOS / iPadOS / Android): company devices only for Turkish
   staff — they confirm them like assets; everybody else sees them as "you are also signed in on" (personal,
   nothing to confirm). Turkish = by name (TURKISH_* below) unless IT set personnel.mobile_policy.
   Assets of a person = Asset Inventory rows whose AD Name equals the local part of their email (same rule
   as the Assets column in User Inventory).

   Open link ("ask everyone", easier): one link for all staff (or one country), e.g. in a mass email / Teams
   post. The person types their work email (main or second); when it is in User Inventory their devices are
   shown and they confirm. A confirm_links row (campaign_id) is made per person, so status, report and the
   signed forms work the same. Weaker than the personal link: anyone who knows a colleague's email could
   open their list — every answer keeps IP / browser, and wrong emails are limited per IP.

   IT admin (logged in):
     GET  /api/confirm/person/:id        status: links, last confirmation per asset, current assets
     POST /api/confirm/person/:id/link   new link → { url, expires_at, … }   (old links stop working)
     POST /api/confirm/person/:id/policy { policy: '' | 'company' | 'personal' }  phones / tablets rule
   Public (no login; the secret is the key):
     POST /api/my-devices/open     { token }                          → { state, first_name }
     POST /api/my-devices/verify   { token, email }                   → { name, assets[] }
     POST /api/my-devices/confirm  { token, email, items: [{ asset_id | device_key, have, note }], extra } */

const express = require('express');
const crypto = require('crypto');
const { get, all, run, batch, audit, notify } = require('../db/database');
const { requireAuth, isITAdmin } = require('../middleware/auth');
const { inScope } = require('../lib/scope');
const { clientIp } = require('../lib/activity');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const LINK_DAYS = 14;
const MAX_ATTEMPTS = 5;
const OPEN_DAYS = 2;              // open links: valid 2 days; a new one cuts older ones to 2 days
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const nowSql = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const normEmail = (e) => String(e || '').trim().toLowerCase();
const localPart = (e) => normEmail(e).split('@')[0];
const origin = (req) => `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}`;

// Turkish staff (company phone / tablet) — recognised by first name, Turkish letters or typical surnames.
const TURKISH_FIRST = new Set(('ahmet mehmet mustafa ali veli hasan huseyin hüseyin ibrahim ismail osman yusuf omer ömer murat emre burak serkan alp can cem kemal okan onur ozan '
  + 'selim tolga fatih volkan kaan baris barış gokhan gökhan erkan erdem ercan erhan cengiz hakan levent mert oguz oğuz orhan recep sinan taner ufuk ugur uğur yasin '
  + 'yasemin ayse ayşe fatma elif zeynep esra merve seda derya gizem ozge özge tuba burcu ebru pinar pınar emine hatice gul gül gulsen gülşen selcan haluk tuncay '
  + 'serdar sedat semih suat tamer tarik tarık turgut umut yavuz yigit yiğit zafer zeki ozgur özgür bulent bülent cagri çağrı caner deniz dilek ece eda ezgi filiz '
  + 'hande ilker ilknur koray melike melis nihat nuri oya ozlem özlem pelin serpil sevgi sibel songul songül sule şule tugba tuğba yesim yeşim kubilay batuhan berk berkay').split(/\s+/));
const TURKISH_LAST = /(oglu|oğlu|türk|turk$|^yilmaz|^yılmaz|^demir|^celik|^çelik|^sahin|^şahin|^yildiz|^yıldız|^aydin|^aydın|^arslan|^aslan|^dogan|^doğan|^kilic|^kılıç|^cetin|^çetin|^koc$|^koç$|^ozdemir|^özdemir|^polat|^erdogan|^erdoğan|^karaduman|^bilgi|^kovulmaz|^gumus|^gümüş|^konak|^bulut|^dinc$|^dinç$|^acar$|^tuncay)/;
function isTurkish(name) {
  const n = String(name || '').replace(/\(.*?\)/g, ' ').trim().toLowerCase();
  if (!n) return false;
  if (/[ğışİ]/i.test(n)) return true;
  const parts = n.split(/\s+/);
  return TURKISH_FIRST.has(parts[0]) || parts.slice(1).some(w => TURKISH_LAST.test(w));
}
const mobileMode = (p) => (p.mobile_policy === 'company' || p.mobile_policy === 'personal' ? p.mobile_policy : isTurkish(p.display_name) ? 'company' : 'personal');
// Phones / tablets of the person from the latest Intune / Entra upload (device rows are replaced on
// every upload, so answers keep the stable device_key).
async function mobilesOf(person) {
  const rows = await all(`SELECT id, device_key, name, os, os_version, model, manufacturer, serial_no, last_checkin, last_sign_in FROM devices
      WHERE person_id = ? ORDER BY name`, [person.id]).catch(() => []);
  return rows.filter(d => /ios|ipad|android/i.test(d.os || '') || /ipad|iphone|tab|phone|galaxy/i.test(d.model || ''))
    .map(d => ({ key: d.device_key || `name:${String(d.name || d.serial_no || d.id).toLowerCase()}`, name: d.name || '', os: [d.os, d.os_version].filter(Boolean).join(' '),
      model: [d.manufacturer, d.model].filter(Boolean).join(' ').trim(), serial: d.serial_no || '', last: String(d.last_checkin || d.last_sign_in || '').slice(0, 10),
      kind: /ipad|tab/i.test(`${d.model} ${d.os}`) ? 'Tablet' : 'Phone' }));
}
const mobileLabel = (m) => `${m.kind} ${m.model || m.name}${m.serial ? ' · SN ' + m.serial : ''}${m.name && m.model ? ' · ' + m.name : ''}`.replace(/\s+/g, ' ').trim();

async function assetsOf(person) {
  if (!localPart(person.email)) return [];
  return all(`SELECT id, asset_s4, asset_code, asset_type, brand_model, serial_no, computer_no, country, location, status
      FROM assets WHERE deleted_at IS NULL AND TRIM(COALESCE(ad_name, '')) <> '' AND LOWER(TRIM(ad_name)) = ?
      ORDER BY asset_type, brand_model, id`, [localPart(person.email)]);
}
const label = (a) => `${a.asset_type || 'Asset'} ${a.brand_model || ''} · ${a.asset_s4 || a.asset_code || '#' + a.id} · SN ${a.serial_no || '—'}`.replace(/\s+/g, ' ').trim();
const publicAsset = (a) => ({ id: a.id, code: a.asset_s4 || a.asset_code || '', type: a.asset_type || '', model: a.brand_model || '',
  serial: a.serial_no || '', pc: a.computer_no || '', place: [a.country, a.location].filter(x => x && x !== '0').join(' · ') });

// ── IT admin ─────────────────────────────────────────────────────────────────
const admin = express.Router();
admin.use(requireAuth);
// Open links ("ask everyone"): admins and editors WITH Asset Inventory access (not User-Inventory-only
// editors); everything else here: IT admins.
const canOpenLinks = (u) => !!u && ['admin', 'editor'].includes(u.role) && u.asset_access !== 0;
admin.use((req, res, next) => (isITAdmin(req.user) || (req.path.startsWith('/campaigns') && canOpenLinks(req.user))
  ? next() : res.status(403).json({ error: req.path.startsWith('/campaigns') ? 'Admins and editors with Asset Inventory access only' : 'IT administrator only' })));

async function personFor(req, res) {
  const p = await get('SELECT id, display_name, email, ad_email, country, status, mobile_policy FROM personnel WHERE id = ?', [Number(req.params.id)]);
  if (!p || !inScope(req, p.country)) { res.status(404).json({ error: 'Person not found' }); return null; }
  return p;
}

admin.get('/person/:id', wrap(async (req, res) => {
  const p = await personFor(req, res); if (!p) return;
  const links = await all(`SELECT id, email, created_by, created_at, expires_at, opened_at, verified_at, confirmed_at, attempts, revoked
      FROM confirm_links WHERE person_id = ? ORDER BY id DESC LIMIT 10`, [p.id]);
  const conf = await all(`SELECT c.* FROM asset_confirmations c WHERE c.person_id = ? AND c.id IN
      (SELECT MAX(id) FROM asset_confirmations WHERE person_id = ? GROUP BY asset_id, COALESCE(device_key, '')) ORDER BY c.confirmed_at DESC`, [p.id, p.id]);
  const assets = await assetsOf(p), mobiles = await mobilesOf(p);
  const last = new Map(conf.filter(c => c.asset_id).map(c => [c.asset_id, c]));
  const lastDev = new Map(conf.filter(c => !c.asset_id && c.device_key).map(c => [c.device_key, c]));
  res.json({ person: p, links, now: nowSql(), mode: mobileMode(p), turkish: isTurkish(p.display_name), policy: p.mobile_policy || '',
    assets: assets.map(a => ({ ...publicAsset(a), status: a.status || '', confirmation: last.get(a.id) || null })),
    mobiles: mobiles.map(m => ({ ...m, confirmation: lastDev.get(m.key) || null })),
    // Confirmed earlier but no longer registered to them (returned / reassigned).
    gone: conf.filter(c => (c.asset_id ? !assets.some(a => a.id === c.asset_id) : !mobiles.some(m => m.key === c.device_key))) });
}));

admin.post('/person/:id/policy', wrap(async (req, res) => {
  const p = await personFor(req, res); if (!p) return;
  const v = ['', 'company', 'personal'].includes(req.body.policy) ? req.body.policy : '';
  await run('UPDATE personnel SET mobile_policy = ? WHERE id = ?', [v, p.id]);
  await audit(req.user, 'UPDATE', null, `My devices: phones / tablets of ${p.display_name} → ${v || 'automatic (by name)'}`);
  res.json({ ok: true, mode: mobileMode({ ...p, mobile_policy: v }) });
}));

// ── Open links ("ask everyone") ──
const { scopeList } = require('../lib/scope');
admin.get('/campaigns', wrap(async (req, res) => {
  const sc = scopeList(req);
  const rows = await all(`SELECT c.*, (SELECT COUNT(*) FROM confirm_links l WHERE l.campaign_id = c.id) AS opened,
      (SELECT COUNT(*) FROM confirm_links l WHERE l.campaign_id = c.id AND l.confirmed_at IS NOT NULL) AS confirmed
      FROM confirm_campaigns c ORDER BY c.id DESC LIMIT 30`);
  res.json({ now: nowSql(), list: rows.filter(c => !sc || (c.country && sc.includes(c.country))).map(c => ({ ...c, url: `${origin(req)}/my-devices.html#t=${c.token}` })) });
}));
admin.post('/campaigns', wrap(async (req, res) => {
  const sc = scopeList(req);
  let country = String(req.body.country || '').trim();
  if (sc && !sc.includes(country)) country = sc[0];          // regional admins: their country only
  // Short-lived on purpose: a shared link that keeps working is easy to misuse. Default 2 days, max 14.
  const days = Math.min(14, Math.max(1, Number(req.body.days) || OPEN_DAYS));
  const name = String(req.body.name || '').trim().slice(0, 80) || `Device check ${new Date().toISOString().slice(0, 10)}${country ? ' — ' + country : ''}`;
  const token = crypto.randomBytes(18).toString('base64url');
  const expires = new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  // Every click makes a new link; the older open links (same country, or all) end within 2 days.
  const cut = new Date(Date.now() + OPEN_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  const older = await all(`SELECT id FROM confirm_campaigns WHERE revoked = 0 AND expires_at > ?${country ? ' AND (country = ? OR country = \'\')' : ''}`, country ? [cut, country] : [cut]);
  await batch([
    ...older.map(o => ({ sql: 'UPDATE confirm_campaigns SET expires_at = ? WHERE id = ?', args: [cut, o.id] })),
    { sql: 'INSERT INTO confirm_campaigns (name, country, token, created_by, expires_at) VALUES (?, ?, ?, ?, ?)', args: [name, country, token, req.user.username, expires] },
  ]);
  await audit(req.user, 'CONFIRM_LINK', null, `My devices: open link "${name}" made (${country || 'all countries'}), valid until ${expires} UTC`);
  res.json({ name, country, expires_at: expires, shortened: older.length, url: `${origin(req)}/my-devices.html#t=${token}`, sender: req.user.full_name || req.user.username });
}));
admin.post('/campaigns/:id/stop', wrap(async (req, res) => {
  const c = await get('SELECT * FROM confirm_campaigns WHERE id = ?', [Number(req.params.id)]);
  const sc = scopeList(req);
  if (!c || (sc && !sc.includes(c.country))) return res.status(404).json({ error: 'Not found' });
  await run('UPDATE confirm_campaigns SET revoked = 1 WHERE id = ?', [c.id]);
  await audit(req.user, 'CONFIRM_LINK', null, `My devices: open link "${c.name}" stopped`);
  res.json({ ok: true });
}));

admin.post('/person/:id/link', wrap(async (req, res) => {
  const p = await personFor(req, res); if (!p) return;
  if (!normEmail(p.email).includes('@')) return res.status(400).json({ error: 'This person has no work email in User Inventory' });
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + LINK_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  await batch([
    { sql: 'UPDATE confirm_links SET revoked = 1 WHERE person_id = ? AND revoked = 0 AND confirmed_at IS NULL', args: [p.id] },
    { sql: 'INSERT INTO confirm_links (person_id, email, token_hash, created_by, expires_at) VALUES (?, ?, ?, ?, ?)',
      args: [p.id, normEmail(p.email), hash(token), req.user.username, expires] },
  ]);
  const assets = await assetsOf(p);
  await audit(req.user, 'CONFIRM_LINK', null, `My devices: link made for ${p.display_name} <${p.email}> (${assets.length} asset${assets.length === 1 ? '' : 's'}), valid until ${expires} UTC`);
  res.json({ url: `${origin(req)}/my-devices.html#t=${token}`, expires_at: expires, name: p.display_name, email: p.email, ad_email: normEmail(p.ad_email) !== normEmail(p.email) ? normEmail(p.ad_email) : '',
    assets: assets.map(publicAsset), sender: req.user.full_name || req.user.username });
}));

// ── Public (the link's secret is the key) ────────────────────────────────────
const pub = express.Router();
// Simple per-IP limit: 40 calls per 10 minutes.
const hits = new Map();
pub.use((req, res, next) => {
  const ip = clientIp(req), t = Date.now();
  const h = (hits.get(ip) || []).filter(x => t - x < 600000); h.push(t); hits.set(ip, h);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(x => t - x < 600000)) hits.delete(k);
  if (h.length > 40) return res.status(429).json({ error: 'Too many tries — please wait 10 minutes.' });
  next();
});

const campaignOf = async (token) => (token.length >= 20 ? get('SELECT * FROM confirm_campaigns WHERE token = ?', [token]) : null);
const campaignOk = (c) => c && !c.revoked && c.expires_at >= nowSql();
// Open link: wrong / unknown emails per IP — 10 per hour.
const misses = new Map();
const missCount = (ip) => (misses.get(ip) || []).filter(t => Date.now() - t < 3600000).length;
async function linkFor(req, res) {
  const token = String((req.body && req.body.token) || '');
  let l = token.length >= 20 ? await get('SELECT * FROM confirm_links WHERE token_hash = ?', [hash(token)]) : null;
  if (!l) {
    const c = await campaignOf(token);
    if (c) {
      if (!campaignOk(c)) { res.status(410).json({ state: 'expired', error: 'This link has ended. Please ask IT.' }); return null; }
      const ip = clientIp(req);
      if (missCount(ip) >= 10) { res.status(429).json({ state: 'locked', error: 'Too many emails that are not in our list — please wait an hour or ask IT.' }); return null; }
      const typed = normEmail(req.body.email);
      const p = typed ? await get(`SELECT id, email FROM personnel WHERE (LOWER(TRIM(email)) = ? OR LOWER(TRIM(COALESCE(ad_email, ''))) = ?)
          AND status <> 'deleted' AND COALESCE(ad_resource, 0) = 0${c.country ? ' AND country = ?' : ''} ORDER BY id LIMIT 1`, c.country ? [typed, typed, c.country] : [typed, typed]) : null;
      if (!p) {
        misses.set(ip, [...(misses.get(ip) || []).filter(t => Date.now() - t < 3600000), Date.now()]);
        await audit(null, 'CONFIRM_REFUSED', null, `My devices (open link #${c.id}): email "${String(req.body.email || '').slice(0, 80)}" not found`);
        res.status(403).json({ state: 'verify', error: 'This email is not in our list. Please type your company email, or ask IT.' }); return null;
      }
      l = await get('SELECT * FROM confirm_links WHERE campaign_id = ? AND person_id = ? ORDER BY id DESC LIMIT 1', [c.id, p.id]);
      if (!l) {
        await run(`INSERT INTO confirm_links (person_id, email, token_hash, created_by, expires_at, campaign_id, opened_at, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [p.id, normEmail(p.email), hash(crypto.randomBytes(24).toString('base64url')), `open link: ${c.name || '#' + c.id}`, c.expires_at, c.id, nowSql(), ip]);
        l = await get('SELECT * FROM confirm_links WHERE campaign_id = ? AND person_id = ? ORDER BY id DESC LIMIT 1', [c.id, p.id]);
      }
      return l;
    }
  }
  if (!l || l.revoked) { res.status(404).json({ state: 'invalid', error: 'This link is not valid any more. Please ask IT for a new one.' }); return null; }
  if (l.expires_at < nowSql() && !l.confirmed_at) { res.status(410).json({ state: 'expired', error: 'This link has expired. Please ask IT for a new one.' }); return null; }
  if (l.attempts >= MAX_ATTEMPTS && !l.verified_at) { res.status(423).json({ state: 'locked', error: 'This link is locked after too many wrong emails. Please ask IT for a new one.' }); return null; }
  return l;
}
async function checkEmail(req, res, l) {
  const typed = normEmail(req.body.email);
  if (typed && typed === normEmail(l.email)) return true;
  const p = typed ? await get('SELECT ad_email FROM personnel WHERE id = ?', [l.person_id]) : null;
  if (p && normEmail(p.ad_email) && typed === normEmail(p.ad_email)) return true;
  await run('UPDATE confirm_links SET attempts = attempts + 1 WHERE id = ?', [l.id]);
  const left = MAX_ATTEMPTS - l.attempts - 1;
  await audit(null, 'CONFIRM_REFUSED', null, `My devices: wrong email "${String(req.body.email || '').slice(0, 80)}" for the link of person #${l.person_id} (${left > 0 ? left + ' tries left' : 'locked'})`);
  res.status(403).json({ state: left > 0 ? 'verify' : 'locked',
    error: left > 0 ? `This email does not match the person this link was sent to. ${left} ${left === 1 ? 'try' : 'tries'} left.`
      : 'This link is now locked after too many wrong emails. Please ask IT for a new one.' });
  return false;
}

pub.post('/open', wrap(async (req, res) => {
  const c = await campaignOf(String((req.body && req.body.token) || ''));
  if (c) {
    if (!campaignOk(c)) return res.status(410).json({ state: 'expired', error: 'This link has ended. Please ask IT.' });
    return res.json({ state: 'verify', open: true, campaign: c.name || '', first_name: '' });
  }
  const l = await linkFor(req, res); if (!l) return;
  if (!l.opened_at) await run('UPDATE confirm_links SET opened_at = ?, ip = ? WHERE id = ?', [nowSql(), clientIp(req), l.id]);
  const p = await get('SELECT display_name FROM personnel WHERE id = ?', [l.person_id]);
  res.json({ state: l.confirmed_at ? 'done' : 'verify', first_name: String((p && p.display_name) || '').trim(),
    confirmed_at: l.confirmed_at });
}));

pub.post('/verify', wrap(async (req, res) => {
  const l = await linkFor(req, res); if (!l) return;
  if (!(await checkEmail(req, res, l))) return;
  if (!l.verified_at) await run('UPDATE confirm_links SET verified_at = ? WHERE id = ?', [nowSql(), l.id]);
  const p = await get('SELECT id, display_name, email, mobile_policy FROM personnel WHERE id = ?', [l.person_id]);
  if (!p) return res.status(404).json({ state: 'invalid', error: 'Not found' });
  const assets = await assetsOf(p), mobiles = await mobilesOf(p);
  const done = l.confirmed_at ? await all('SELECT asset_id, device_key, result, note FROM asset_confirmations WHERE link_id = ?', [l.id]) : [];
  res.json({ name: p.display_name, email: p.email, confirmed_at: l.confirmed_at, expires_at: l.expires_at, mode: mobileMode(p),
    assets: assets.map(a => ({ ...publicAsset(a), result: (done.find(d => d.asset_id === a.id) || {}).result || null })),
    mobiles: mobiles.map(m => ({ key: m.key, kind: m.kind, model: m.model, name: m.name, os: m.os, serial: m.serial, last: m.last,
      result: (done.find(d => !d.asset_id && d.device_key === m.key) || {}).result || null })) });
}));

pub.post('/confirm', wrap(async (req, res) => {
  const l = await linkFor(req, res); if (!l) return;
  if (l.confirmed_at) return res.status(409).json({ error: `Already confirmed on ${l.confirmed_at} UTC.` });
  if (!(await checkEmail(req, res, l))) return;
  const p = await get('SELECT id, display_name, email, country, mobile_policy FROM personnel WHERE id = ?', [l.person_id]);
  const assets = await assetsOf(p);
  const mobiles = mobileMode(p) === 'company' ? await mobilesOf(p) : [];
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const signed = normEmail(req.body.email);     // the checked work email (either of theirs) is the signature
  const byId = new Map(items.filter(i => i.asset_id).map(i => [Number(i.asset_id), i]));
  const byKey = new Map(items.filter(i => i.device_key).map(i => [String(i.device_key), i]));
  const missing = assets.filter(a => !byId.has(a.id) || typeof byId.get(a.id).have !== 'boolean').length
    + mobiles.filter(m => !byKey.has(m.key) || typeof byKey.get(m.key).have !== 'boolean').length;
  if (missing) return res.status(400).json({ error: 'Please answer every device (I have it / Not with me).' });
  const ip = clientIp(req), ua = String(req.headers['user-agent'] || '').slice(0, 300), at = nowSql();
  const notHave = [];
  const stmts = assets.map(a => {
    const i = byId.get(a.id);
    if (!i.have) notHave.push(`${label(a)}${i.note ? ' — "' + String(i.note).slice(0, 200) + '"' : ''}`);
    return { sql: `INSERT INTO asset_confirmations (link_id, person_id, email, asset_id, asset_label, result, note, signed_name, confirmed_at, ip, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [l.id, p.id, l.email, a.id, label(a), i.have ? 'have' : 'not_have', String(i.note || '').trim().slice(0, 300), signed, at, ip, ua] };
  });
  for (const m of mobiles) {
    const i = byKey.get(m.key);
    if (!i.have) notHave.push(`${mobileLabel(m)}${i.note ? ' — "' + String(i.note).slice(0, 200) + '"' : ''}`);
    stmts.push({ sql: `INSERT INTO asset_confirmations (link_id, person_id, email, asset_id, device_key, asset_label, result, note, signed_name, confirmed_at, ip, user_agent)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [l.id, p.id, l.email, m.key, mobileLabel(m), i.have ? 'have' : 'not_have', String(i.note || '').trim().slice(0, 300), signed, at, ip, ua] });
  }
  stmts.push({ sql: 'UPDATE confirm_links SET confirmed_at = ? WHERE id = ?', args: [at, l.id] });
  await batch(stmts);
  const who = { id: null, username: `${p.email} (My devices)` };
  for (const a of assets) await audit(who, 'CONFIRM_ASSET', a.id, `My devices: ${p.display_name} ${byId.get(a.id).have ? 'confirmed they have' : 'says NOT with them'} ${label(a)} — signed with ${signed}`);
  for (const m of mobiles) await audit(who, 'CONFIRM_ASSET', null, `My devices: ${p.display_name} ${byKey.get(m.key).have ? 'confirmed they have' : 'says NOT with them'} ${mobileLabel(m)} — signed with ${signed}`);
  if (!assets.length && !mobiles.length) await audit(who, 'CONFIRM_ASSET', null, `My devices: ${p.display_name} confirmed they have no company device registered — signed with ${signed}`);
  const extra = String(req.body.extra || '').trim().slice(0, 300);
  if (extra) await audit(who, 'CONFIRM_ASSET', null, `My devices: ${p.display_name} also has / notes: "${extra}"`);
  if (notHave.length || extra) await notify({ audience: 'IT', country: p.country || null, scope: 'personnel', level: 'warning',
    message: `📋 My devices — ${p.display_name}: ${notHave.length ? `NOT with them: ${notHave.join('; ')}` : ''}${notHave.length && extra ? ' · ' : ''}${extra ? `other device / note: "${extra}"` : ''}` });
  res.json({ ok: true, confirmed_at: at, count: assets.length + mobiles.length, not_with_me: notHave.length, signed_with: signed });
}));

// ── Signed forms (admins / editors): Delivery-Acceptance form + Custody Agreement with the e-signature ──
//   GET /api/confirm-forms/person/:id      latest confirmed link of a person → forms data
//   GET /api/confirm-forms/:linkId         forms data: person, signature, devices answered "I have it"
//   GET /api/confirm-forms/:linkId/delivery.xlsx   the company Excel form, filled + signed
const forms = express.Router();
forms.use(requireAuth);
forms.use((req, res, next) => (req.user && ['admin', 'editor'].includes(req.user.role) ? next() : res.status(403).json({ error: 'Admins and editors only' })));
const dmy = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
async function formsData(req, res, linkId) {
  const l = await get('SELECT * FROM confirm_links WHERE id = ? AND confirmed_at IS NOT NULL', [linkId]);
  const p = l && await get('SELECT id, display_name, email, ad_email, country, department FROM personnel WHERE id = ?', [l.person_id]);
  if (!l || !p || !inScope(req, p.country)) { res.status(404).json({ error: 'No signed confirmation found' }); return null; }
  const rows = await all(`SELECT c.*, a.asset_s4, a.asset_code, a.asset_type, a.brand_model, a.serial_no, a.department AS a_dept
      FROM asset_confirmations c LEFT JOIN assets a ON a.id = c.asset_id WHERE c.link_id = ? ORDER BY c.asset_id = 0, c.id`, [l.id]);
  const devs = new Map((await all('SELECT device_key, os, model, manufacturer, serial_no, name FROM devices WHERE person_id = ?', [p.id]).catch(() => [])).map(d => [d.device_key, d]));
  const it = await get('SELECT full_name FROM users WHERE username = ?', [l.created_by]);
  const first = rows[0] || {};
  const items = rows.filter(r => r.result === 'have').map(r => {
    if (r.asset_id) return { key: 'a' + r.asset_id, kind: 'asset', id: r.asset_id, type: r.asset_type || '', code: r.asset_code || '', s4: r.asset_s4 || '',
      brand_model: r.brand_model || '', serial: r.serial_no || '', label: r.asset_label };
    const d = devs.get(r.device_key) || {};
    const kind = /tablet/i.test(r.asset_label) ? 'Tablet' : 'Phone';
    return { key: 'd' + r.id, kind: 'device', id: 0, type: kind, code: '', s4: '', brand_model: [d.manufacturer, d.model].filter(Boolean).join(' ') || r.asset_label.replace(/^(Phone|Tablet)\s+/, '').split(' · ')[0],
      serial: d.serial_no || ((r.asset_label.match(/SN ([^ ·]+)/) || [])[1] || ''), label: r.asset_label };
  });
  return { link_id: l.id, person: { name: p.display_name, email: p.email, ad_email: p.ad_email || '', country: p.country, department: p.department || (rows.find(r => r.a_dept) || {}).a_dept || '' },
    signed: { with: first.signed_name || l.email, at: l.confirmed_at, ip: first.ip || '', browser: String(first.user_agent || '').replace(/^Mozilla\/5\.0 \(([^)]*)\).*$/, '$1').slice(0, 80), ref: `MD-${l.id}` },
    it_member: (it && it.full_name) || l.created_by || '', sent_at: l.created_at,
    not_with: rows.filter(r => r.result === 'not_have').map(r => ({ label: r.asset_label, note: r.note })), items,
    commitments: require('../lib/delivery-form').commitmentsText() };
}
const signatureText = (d) => `E-signed (My devices) by ${d.signed.with} · ${d.signed.at} UTC · IP ${d.signed.ip} · ref ${d.signed.ref}`;
forms.get('/person/:id', wrap(async (req, res) => {
  const l = await get('SELECT id FROM confirm_links WHERE person_id = ? AND confirmed_at IS NOT NULL ORDER BY id DESC LIMIT 1', [Number(req.params.id)]);
  if (!l) return res.status(404).json({ error: 'Not confirmed yet' });
  const d = await formsData(req, res, l.id); if (d) res.json(d);
}));
forms.get('/:linkId/delivery.xlsx', wrap(async (req, res) => {
  const d = await formsData(req, res, Number(req.params.linkId)); if (!d) return;
  const { buildSignedDeliveryForm } = require('../lib/delivery-form');
  const buf = buildSignedDeliveryForm({ department: d.person.department, it_member: d.it_member, user_name: d.person.name, signature: signatureText(d),
    items: d.items.slice(0, 7).map(i => ({ description: [i.type, i.brand_model].filter(Boolean).join(' · '), code: i.s4 || i.code, serial: i.serial, date: String(d.signed.at).slice(0, 10) })) });
  await audit(req.user, 'PRINT', null, `My devices: signed delivery form of ${d.person.name} (${d.signed.ref}) downloaded`);
  const safe = String(d.person.name || d.link_id).replace(/[^\w.-]+/g, '_').slice(0, 40);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Delivery-Form-signed-${safe}.xlsx"`);
  res.send(buf);
}));
forms.get('/:linkId', wrap(async (req, res) => {
  const d = await formsData(req, res, Number(req.params.linkId)); if (d) res.json({ ...d, signature: signatureText(d), date_dmy: dmy(d.signed.at) });
}));

module.exports = { admin, pub, forms };
