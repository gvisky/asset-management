/* The app owner (username "viet", or APP_OWNER in deploy/.env). The owner's login can never be deleted, and nobody else
   can change it (role, team, countries, password, two-step login). It is always a global admin in the IT team — even the
   owner can only change their own name and password. If the account is ever missing it is recreated on start
   (db/database.js ensureOwner, password = ADMIN_PASS). */
const OWNER = String(process.env.APP_OWNER || 'viet').trim().toLowerCase();
const isOwner = (username) => String(username || '').trim().toLowerCase() === OWNER;
module.exports = { OWNER, isOwner };
