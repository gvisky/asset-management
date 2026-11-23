/* Network team (team 'NET'): looks after every network device — IT and OT alike.
   - Server Inventory: only the network devices (switches, routers, firewalls, voice gateways, wireless controllers,
     access points …) of IT and OT — no servers, storage, PCs, cameras.
   - Network map: the full map (IT + OT, racks, drawings); NET editors change ports, a NET admin also imports /
     deletes map devices. OT Reports (read).
   - Nothing else: no Asset / User Inventory, Budget, System Health, Recycle Bin, Users & Audit
     (server.js blocks every other API and page for them). A NET "admin" is a NET editor + net_admin everywhere else. */
const NET_CAT_RE = /switch|router|firewall|gateway|wireless|\bwlc\b|access\s*point|\bap\b|network|modem|load\s*balancer|sfp|transceiver/i;
const NET_CAT_SQL = "(" + ['%switch%', '%router%', '%firewall%', '%gateway%', '%wireless%', '%wlc%', '%access point%', '%network%', '%modem%', '%load balancer%', '%sfp%', '%transceiver%']
  .map(p => `LOWER(COALESCE(category, '')) LIKE '${p}'`).join(' OR ') + ')';

const isNET = (u) => !!u && u.team === 'NET';
const isNetCategory = (c) => NET_CAT_RE.test(String(c || ''));

// What a NET user may reach — everything else answers 403 (APIs) or goes back to the Network map (pages).
const NET_API = ['/api/auth', '/api/servers', '/api/netmap', '/api/ot-reports', '/api/notifications', '/api/countries', '/api/version'];
const NET_PAGES = ['/home.html', '/network-map.html', '/server-inventory.html', '/ot-reports.html', '/mfa-setup.html'];
const netApiAllowed = (p) => NET_API.some(a => p === a || p.startsWith(a + '/'));
const netPageAllowed = (p) => !/\.html$/i.test(p) && p !== '/' ? true : NET_PAGES.includes(p);

module.exports = { isNET, isNetCategory, NET_CAT_SQL, netApiAllowed, netPageAllowed, NET_PAGES };
