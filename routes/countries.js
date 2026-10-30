const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const { knownCountries } = require('../lib/country-list');
const { scopeList } = require('../lib/scope');
const { CORE_COUNTRIES } = require('../lib/countries');

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
router.use(requireAuth);

// ── GET /api/countries — countries the user can see (+ the full list) ─────────
// countries: what this user may view / pick (all for global users).
// all:       every known country (for the Users & Audit country picker).
router.get('/', wrap(async (req, res) => {
  const all = await knownCountries();
  const mine = scopeList(req);
  res.json({ countries: mine || all, all, core: CORE_COUNTRIES, scoped: !!mine });
}));

module.exports = router;
