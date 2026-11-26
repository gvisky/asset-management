/* 🎬 Videos with a public link (/videos.html): IT uploads a video (in pieces, so no request is too big for the tunnel), the app
   keeps it in the database (media_videos + media_chunks, 2 MB pieces) and gives it a public link that plays without login:
     /v/<token>              watch page (player, title; link previews show the poster)
     /media/<token>.mp4      the video, with Range support (seek, iPhone / Apple Mail play it)
     /media/<token>.jpg      the poster (first frame with a play button) — the picture in the e-mail
   The token is random and long, so only people who get the link can open it; IT can switch the link off or delete the video.
   admin:  GET /api/media · POST /api/media · PUT /api/media/:id/chunk { n, data_b64 } · POST /api/media/:id/done · PUT /api/media/:id · DELETE /api/media/:id */
const express = require('express');
const crypto = require('crypto');
const { get, all, run, audit } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const str = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);
const CHUNK = 2 * 1024 * 1024;   // bytes per piece
const MAX = 500 * 1024 * 1024;   // largest video
const canManage = (u) => !!u && u.team === 'IT' && ['admin', 'editor'].includes(u.role);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Admin (logged-in IT) ─────────────────────────────────────────────────────
const admin = express.Router();
admin.use(requireAuth);
admin.use((req, res, next) => (canManage(req.user) ? next() : res.status(403).json({ error: 'IT admins and editors only' })));
const pub = (v) => ({ id: v.id, token: v.token, title: v.title, note: v.note, mime: v.mime, size: v.size, duration: v.duration, width: v.width, height: v.height,
  ready: !!v.ready, public: !!v.public, views: v.views, uploaded_by: v.uploaded_by, uploaded_at: v.uploaded_at });
admin.get('/', wrap(async (req, res) => {
  const rows = await all('SELECT id, token, title, note, mime, size, duration, width, height, ready, public, views, uploaded_by, uploaded_at FROM media_videos ORDER BY id DESC');
  res.json({ rows: rows.map(pub), chunk: CHUNK });
}));
admin.post('/', wrap(async (req, res) => {
  const b = req.body || {}, size = Number(b.size) || 0, mime = str(b.mime, 40) || 'video/mp4';
  if (!/^video\/(mp4|webm|quicktime)$/.test(mime)) return res.status(400).json({ error: 'MP4, WebM or MOV videos only' });
  if (size <= 0 || size > MAX) return res.status(400).json({ error: `The video must be smaller than ${MAX / 1024 / 1024} MB` });
  const poster = String(b.poster_b64 || '');
  if (poster.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Poster picture too large' });
  const token = crypto.randomBytes(18).toString('base64url');
  const r = await run(`INSERT INTO media_videos (token, title, note, mime, size, chunk_size, chunks, duration, width, height, poster_b64, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [token, str(b.title, 150) || 'Video', str(b.note, 1000), mime, size, CHUNK, Math.ceil(size / CHUNK), Number(b.duration) || 0, Number(b.width) || 0, Number(b.height) || 0, poster, req.user.username]);
  res.json({ id: Number(r.lastInsertRowid), token, chunk: CHUNK, chunks: Math.ceil(size / CHUNK) });
}));
admin.put('/:id/chunk', wrap(async (req, res) => {
  const v = await get('SELECT id, chunks, ready FROM media_videos WHERE id = ?', [Number(req.params.id)]);
  if (!v || v.ready) return res.status(404).json({ error: 'Upload not found' });
  const n = Number(req.body.n), data = String(req.body.data_b64 || '');
  if (!Number.isInteger(n) || n < 0 || n >= v.chunks || !data || data.length > Math.ceil(CHUNK / 3) * 4 + 8) return res.status(400).json({ error: 'Bad piece' });
  await run('INSERT INTO media_chunks (video_id, n, data_b64) VALUES (?, ?, ?) ON CONFLICT(video_id, n) DO UPDATE SET data_b64 = excluded.data_b64', [v.id, n, data]);
  res.json({ ok: true });
}));
admin.post('/:id/done', wrap(async (req, res) => {
  const v = await get('SELECT * FROM media_videos WHERE id = ?', [Number(req.params.id)]);
  if (!v) return res.status(404).json({ error: 'Upload not found' });
  const got = await get('SELECT COUNT(*) AS n FROM media_chunks WHERE video_id = ?', [v.id]);
  if (Number(got.n) !== v.chunks) return res.status(400).json({ error: `Upload incomplete (${got.n} of ${v.chunks} pieces) — try again` });
  await run('UPDATE media_videos SET ready = 1 WHERE id = ?', [v.id]);
  await audit(req.user, 'CREATE', null, `Video "${v.title}" uploaded (${Math.round(v.size / 1024 / 1024)} MB, public link /v/${v.token.slice(0, 6)}…)`);
  res.json({ ok: true, video: pub({ ...v, ready: 1 }) });
}));
admin.put('/:id', wrap(async (req, res) => {
  const v = await get('SELECT * FROM media_videos WHERE id = ?', [Number(req.params.id)]);
  if (!v) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  await run('UPDATE media_videos SET title = ?, note = ?, public = ? WHERE id = ?',
    ['title' in b ? str(b.title, 150) || v.title : v.title, 'note' in b ? str(b.note, 1000) : v.note, 'public' in b ? (b.public ? 1 : 0) : v.public, v.id]);
  if ('public' in b && !!b.public !== !!v.public) await audit(req.user, 'UPDATE', null, `Video "${v.title}": public link ${b.public ? 'on' : 'off'}`);
  res.json({ ok: true });
}));
admin.delete('/:id', wrap(async (req, res) => {
  const v = await get('SELECT id, title FROM media_videos WHERE id = ?', [Number(req.params.id)]);
  if (!v) return res.status(404).json({ error: 'Not found' });
  await run('DELETE FROM media_chunks WHERE video_id = ?', [v.id]);
  await run('DELETE FROM media_videos WHERE id = ?', [v.id]);
  await audit(req.user, 'DELETE', null, `Video "${v.title}" deleted`);
  res.json({ ok: true });
}));

// ── Public (no login) ────────────────────────────────────────────────────────
const open = async (token) => (/^[A-Za-z0-9_-]{16,40}$/.test(token) ? get('SELECT * FROM media_videos WHERE token = ? AND ready = 1 AND public = 1', [token]) : null);
const gone = (res) => res.status(404).type('html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Video</title><body style="font-family:system-ui;padding:40px;color:#475569">This video is not available (the link was switched off or the video was removed).</body>');
const pubRouter = express.Router();
pubRouter.get('/media/:file', wrap(async (req, res) => {
  const m = String(req.params.file).match(/^([A-Za-z0-9_-]+)\.(mp4|webm|mov|jpg)$/); if (!m) return res.status(404).end();
  const v = await open(m[1]); if (!v) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (m[2] === 'jpg') { if (!v.poster_b64) return res.status(404).end(); return res.type('image/jpeg').send(Buffer.from(v.poster_b64, 'base64')); }
  // Range (seek / iPhone): only the pieces that are needed are read.
  const size = v.size; let start = 0, end = size - 1, part = false;
  const r = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
  if (r) {
    if (r[1] === '' && r[2] !== '') { start = Math.max(0, size - Number(r[2])); } else { start = Number(r[1]) || 0; if (r[2] !== '') end = Math.min(size - 1, Number(r[2])); }
    if (start >= size || start > end) { res.setHeader('Content-Range', `bytes */${size}`); return res.status(416).end(); }
    part = true;
  }
  res.status(part ? 206 : 200);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', v.mime);
  res.setHeader('Content-Length', end - start + 1);
  if (part) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  if (req.method === 'HEAD') return res.end();
  if (start === 0) run('UPDATE media_videos SET views = views + 1 WHERE id = ?', [v.id]).catch(() => {});
  const cs = v.chunk_size;
  for (let n = Math.floor(start / cs); n <= Math.floor(end / cs); n++) {
    const c = await get('SELECT data_b64 FROM media_chunks WHERE video_id = ? AND n = ?', [v.id, n]);
    if (!c) break;
    const buf = Buffer.from(c.data_b64, 'base64'), from = n * cs;
    const piece = buf.subarray(Math.max(0, start - from), Math.min(buf.length, end - from + 1));
    if (!res.write(piece)) await new Promise(ok => res.once('drain', ok));
    if (res.destroyed) return;
  }
  res.end();
}));
pubRouter.get('/v/:token', wrap(async (req, res) => {
  const v = await open(req.params.token); if (!v) return gone(res);
  const base = `${String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim()}://${req.get('host')}`, src = `${base}/media/${v.token}.mp4`, poster = v.poster_b64 ? `${base}/media/${v.token}.jpg` : '';
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(v.title)}</title><meta name="robots" content="noindex">
<meta property="og:type" content="video.other"><meta property="og:title" content="${esc(v.title)}">${poster ? `<meta property="og:image" content="${poster}">` : ''}
<meta property="og:video" content="${src}"><meta property="og:video:type" content="${esc(v.mime)}">${v.width ? `<meta property="og:video:width" content="${v.width}"><meta property="og:video:height" content="${v.height}">` : ''}
<style>body{margin:0;background:#0f172a;color:#e2e8f0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;align-items:center;min-height:100vh}
main{width:min(1100px,100%);padding:24px 16px;box-sizing:border-box}h1{font-size:20px;margin:0 0 12px}video{width:100%;border-radius:10px;background:#000;box-shadow:0 10px 40px rgba(0,0,0,.5)}
p{color:#94a3b8;white-space:pre-line}footer{margin-top:auto;padding:14px;color:#64748b;font-size:12px}</style></head>
<body><main><h1>${esc(v.title)}</h1><video controls playsinline preload="metadata"${poster ? ` poster="${poster}"` : ''} src="${src}"></video>${v.note ? `<p>${esc(v.note)}</p>` : ''}</main>
<footer>Hayat Communication Tools</footer></body></html>`);
}));

module.exports = { admin, pub: pubRouter };
