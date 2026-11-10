const express = require('express');
const path = require('path');
const { init } = require('./db/database');
const { getUserFromRequest } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// Request bodies: 1 MB normally; up to 75 MB (raw CSV / base64 .xlsx uploads, budget report ~50 MB)
// only for a logged-in user — so nobody can tie up the server with huge bodies before logging in.
const smallJson = express.json({ limit: '1mb' }), bigJson = express.json({ limit: '75mb' });
const smallForm = express.urlencoded({ extended: true, limit: '1mb' }), bigForm = express.urlencoded({ extended: true, limit: '75mb' });
app.use(async (req, res, next) => {
  try {
    const large = Number(req.headers['content-length'] || 0) > 1024 * 1024
      && !req.path.startsWith('/api/auth') && !req.path.startsWith('/api/health/ingest')
      && !!(await getUserFromRequest(req));
    (large ? bigJson : smallJson)(req, res, (err) => (err ? next(err) : (large ? bigForm : smallForm)(req, res, next)));
  } catch (e) { next(e); }
});

// API routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/assets',    require('./routes/assets'));
app.use('/api/servers',   require('./routes/servers'));
app.use('/api/users',     require('./routes/users'));
app.use('/api/personnel', require('./routes/personnel'));
app.use('/api/maintenance', require('./routes/maintenance'));
app.use('/api/licenses', require('./routes/licenses'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/budget', require('./routes/budget'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/countries', require('./routes/countries'));
app.use('/api/devices', require('./routes/devices'));
app.use('/api/health',  require('./routes/health'));

// Public files that must load before login (login page + shared CSS/JS)
const PUBLIC_FILES = ['/login.html', '/css/style.css', '/js/auth.js', '/js/login.js', '/favicon.ico'];

// Which build is running (Render sets RENDER_GIT_COMMIT) — to check a deploy really went live.
app.get('/api/version', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ commit: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || 'local', started: STARTED });
});
const STARTED = new Date().toISOString();

// Gate the HTML pages: anyone not logged in is redirected to /login.html
app.use(async (req, res, next) => {
  try {
    if (req.path.startsWith('/api')) return next();
    if (PUBLIC_FILES.includes(req.path)) return next();

    const user = await getUserFromRequest(req);
    if (!user) {
      if (req.method === 'GET' && req.accepts('html')) return res.redirect('/login.html');
      return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
  } catch (e) { next(e); }
});

// Static files (served after the gate above)
// Pages, scripts and styles change with every deploy: browsers / Cloudflare must check for a newer copy.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => {
    if (/\.(html|js|css|json)$/i.test(file)) {
      // no-store: never keep a copy (browser or CDN) — pages are behind the login and change with every deploy.
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('CDN-Cache-Control', 'no-store');
      res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
    }
  },
}));

// Fallback for any other GET → index.html (already gated above)
app.get(/^(?!\/api).*$/, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'The upload is too large (or you are not logged in).' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request data' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// Initialise the database (schema + seed), then start listening.
init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n  Asset Management running at http://localhost:${PORT}\n`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });
