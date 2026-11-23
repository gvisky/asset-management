/* Overview for teams without the Asset pages (docs/UX-REDESIGN.md, phase 5) — /home.html.
   HR: people, leavers, people to check. OT: OT devices and what to check. Network: network devices of IT and OT by
   category. Every number comes from an API the team already uses (same permissions); asset users go to the main Overview. */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const n = (v) => Number(v || 0).toLocaleString();
  const get = (u) => apiGet(u).catch(() => null);
  const tile = (label, value, color, href, sub) => `<a class="hm-tile" href="${href}" style="--kc:${color}"><div class="hm-t-l"><span style="background:${color}"></span>${esc(label)}</div><div class="hm-t-v">${value}</div>${sub ? `<div class="hm-t-s">${sub}</div>` : ''}</a>`;
  const card = (title, href, link, body) => `<div class="card"><div class="card-header"><span class="card-title">${esc(title)}</span>${href ? `<a class="btn btn-ghost btn-sm" href="${href}">${esc(link)} →</a>` : ''}</div><div class="card-body">${body}</div></div>`;
  const rows = (list, empty) => list.length ? list.map(r => `<a class="ov-row" href="${esc(r.href)}"><span class="ov-lbl">${esc(r.label)}</span><b>${n(r.count)}</b></a>`).join('') : `<div class="ov-ok">${empty}</div>`;
  const links = (l) => `<div class="hm-links">${l.map(([h, t, d]) => `<a href="${h}"><b>${esc(t)}</b><span>${esc(d)}</span></a>`).join('')}</div>`;

  async function hr() {
    const [s, lv, ib] = await Promise.all([get('/api/personnel/summary'), get('/api/leavers'), get('/api/inbox')]);
    const open = ((lv && lv.list) || []).filter(p => p.open > 0);
    const late = open.filter(p => p.days_left != null && p.days_left < 0);
    $('hm-kpis').innerHTML = [
      tile('People', n(s && s.total), '#2563eb', '/user-inventory.html', s ? `${n(s.byStatus && s.byStatus.Active)} active` : ''),
      tile('Leaving (date set)', n(s && s.leaving), '#d97706', '/leavers.html'),
      tile('Leavers with open checklist', n(open.length), late.length ? '#dc2626' : '#d97706', '/leavers.html', late.length ? `${late.length} already gone` : ''),
      tile('People to check', n(s && s.attention && s.attention.total), '#7c3aed', '/user-inventory.html', 'AD / Azure differences'),
    ].join('');
    $('hm-cards').innerHTML = card('Leavers with open checklist items', '/leavers.html', 'Leavers',
      open.length ? open.sort((a, b) => (a.days_left ?? 999) - (b.days_left ?? 999)).slice(0, 8).map(p => `<div class="ib-row"><div><b>${esc(p.display_name || p.email)}</b> <span class="text-muted text-sm">${esc(p.department || '')}</span></div><div class="text-sm">${p.days_left == null ? '' : p.days_left < 0 ? `<span class="ib-late">left ${-p.days_left} d ago</span>` : `in ${p.days_left} d`} · <b>${p.open}</b> open</div></div>`).join('') : '<div class="ov-ok">✅ No open leaver checklists.</div>')
      + card('Inbox', '/inbox.html', 'Open Inbox', rows(((ib && ib.areas) || []).flatMap(a => a.items), '✅ Nothing to fix right now.'))
      + card('Go to', null, null, links([['/user-inventory.html', 'Users', 'People, departments, cost centers, confirmations'], ['/leavers.html', 'Leavers', 'Return checklist — devices back within 7 days']]));
  }

  async function ot() {
    const [all, att] = await Promise.all([get('/api/servers?limit=1'), get('/api/servers/ot-attention')]);
    const groups = (att && att.groups) || [];
    const toCheck = groups.reduce((t, g) => t + (g.rows || []).length, 0);
    $('hm-kpis').innerHTML = [
      tile('OT devices', n(all && all.total), '#ea580c', '/server-inventory.html'),
      tile('Things to check', n(toCheck), toCheck ? '#d97706' : '#16a34a', '/ot-attention.html', `${groups.length} kind${groups.length === 1 ? '' : 's'}`),
    ].join('');
    $('hm-cards').innerHTML = card('OT needs attention', '/ot-attention.html', 'Open', rows(groups.map(g => ({ label: g.title, count: (g.rows || []).length, href: '/ot-attention.html#' + g.key })), '✅ All OT devices look fine.'))
      + card('Go to', null, null, links([['/network-map.html', 'Network map', 'Kabin switches and what is connected to them'], ['/server-inventory.html', 'OT devices', 'Cameras, access control, PLCs, gateways …'], ['/ot-reports.html', 'OT reports', 'Excel / PDF reports of the OT devices']]));
  }

  async function net() {
    const [all, f] = await Promise.all([get('/api/servers?limit=1'), get('/api/servers/filters')]);
    const cats = (f && f.categories) || [];
    const per = await Promise.all(cats.map(async c => {
      const [a, o] = await Promise.all([get('/api/servers?limit=1&category=' + encodeURIComponent(c)), get('/api/servers?limit=1&it_ot=OT&category=' + encodeURIComponent(c))]);
      const t = a ? a.total : 0, ot = o ? o.total : 0;
      return { c, t, ot, it: t - ot };
    }));
    per.sort((a, b) => b.t - a.t);
    const otTotal = per.reduce((s, x) => s + x.ot, 0);
    $('hm-kpis').innerHTML = [
      tile('Network devices', n(all && all.total), '#2563eb', '/server-inventory.html', `${n((all && all.total) - otTotal)} IT · ${n(otTotal)} OT`),
      tile('Categories', n(cats.length), '#0891b2', '/server-inventory.html'),
    ].join('');
    $('hm-cards').innerHTML = card('Network devices by category', '/server-inventory.html', 'Network devices',
      per.length ? `<table class="hm-tbl"><thead><tr><th>Category</th><th>IT</th><th>OT</th><th>Total</th></tr></thead><tbody>${per.map(x => `<tr><td><a href="/server-inventory.html">${esc(x.c)}</a></td><td>${n(x.it)}</td><td>${n(x.ot)}</td><td><b>${n(x.t)}</b></td></tr>`).join('')}</tbody></table>` : '<div class="text-muted text-sm">No network devices yet.</div>')
      + card('Go to', null, null, links([['/network-map.html', 'Network map', 'IT and OT views, racks, drawings, ports'], ['/server-inventory.html', 'Network devices', 'Switches, routers, firewalls, access points …'], ['/ot-reports.html', 'OT reports', 'Excel / PDF reports of the OT side']]));
  }

  document.addEventListener('DOMContentLoaded', () => {
    const t = setInterval(() => {
      const u = window.CURRENT_USER; if (!u) return; clearInterval(t);
      if (Number(u.asset_access) !== 0) { location.replace('/'); return; }   // asset users have the main Overview
      const h = new Date().getHours();
      $('hm-hello').innerHTML = `<h2>${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, ${esc(String(u.full_name || u.username).split(' ')[0])}</h2>
        <div class="text-muted text-sm">${u.team === 'HR' ? 'People and leavers' : u.team === 'OT' ? 'OT devices and the factory network' : u.team === 'NET' ? 'Network devices of IT and OT' : ''}</div>`;
      ({ HR: hr, OT: ot, NET: net }[u.team] || (() => { $('hm-cards').innerHTML = '<p class="text-muted">Nothing here for this account yet.</p>'; }))();
    }, 100);
  });
})();
