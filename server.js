const express = require('express');
const path = require('path');
const { init } = require('./db/database');
const { getUserFromRequest } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/assets',    require('./routes/assets'));
app.use('/api/users',     require('./routes/users'));
app.use('/api/personnel', require('./routes/personnel'));

// Public files that must load before login (login page + shared CSS/JS)
const PUBLIC_FILES = ['/login.html', '/css/style.css', '/js/auth.js', '/js/login.js', '/favicon.ico'];

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
app.use(express.static(path.join(__dirname, 'public')));

// Fallback for any other GET → index.html (already gated above)
app.get(/^(?!\/api).*$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
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
