/* Needs Attention panel — shared by the Dashboard and Asset Inventory.
   Country tabs, VN Office / Factory buttons, asset-type filter, issue chips,
   and rows whose missing fields can be filled in place.

   Modes:
     'missing' — Missing Info (Serial / Asset code / PC No / AD Name / duplicate serial)
     'ad'      — Missing AD & Asset (AD Name missing, or AD Name not found in User Inventory)

   Needs app.js (apiGet/apiPut, showToast, missingInfoTags, typeRank, SITE_COUNTRY)
   and auth.js (canEdit, isIT, ensureAuth). */
(function () {
  const COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];
  const SITES = ['Office', 'Factory'];
  const PROTECTED = ['serial_no', 'asset_code'];      // IT-only fields (server: PROTECTED_FIELDS)
  const AD_MISSING = 'AD Name missing';
  const AD_UNMATCHED = 'AD not in User Inventory';

  const MODES = {
    missing: {
      title: '⚠️ Needs Attention — Missing Info',
      issues: ['Asset code', 'Serial', 'PC No', 'AD Name', 'Dup Serial'],
      fields: { 'Serial': 'serial_no', 'Asset code': 'asset_code', 'PC No': 'computer_no', 'AD Name': 'ad_name' },
      load: async () => apiGet('/api/assets/incomplete'),
      issuesOf: (a) => { const t = missingInfoTags(a); if (a.dup_serial) t.push('Dup Serial'); return t; },
      empty: 'have their key info. 🎉',
      link: 'incomplete',
    },
    ad: {
      title: '⚠️ Needs Attention — Missing AD & Asset',
      issues: [AD_MISSING, AD_UNMATCHED],
      fields: { [AD_MISSING]: 'ad_name', [AD_UNMATCHED]: 'ad_name' },
      load: async () => (await apiGet('/api/assets?ad_issue=1&limit=10000')).data || [],
      issuesOf: (a) => a.ad_issue_reason === 'missing' ? [AD_MISSING] : a.ad_issue_reason === 'unmatched' ? [AD_UNMATCHED] : [],
      empty: 'have a matching AD Name. 🎉',
      link: 'ad_issue',
    },
  };

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const link = (params) => '/inventory.html?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();

  function editable(a, field) {
    if (!canEdit()) return { ok: false, why: 'View only' };
    if (PROTECTED.includes(field)) {
      if (!isIT()) return { ok: false, why: 'Only IT members can edit Serial / Asset code' };
      if (a.fields_locked) return { ok: false, why: 'Locked — an IT admin must unlock this record first' };
    }
    if (field === 'ad_name' && a.user_locked) return { ok: false, why: 'Locked — an IT admin must unlock via History Usage' };
    return { ok: true };
  }

  /**
   * opts: { root: Element, mode: 'missing'|'ad',
   *         scope?: () => country to follow when no tab is picked (Dashboard switch),
   *         initial?: { country, site, type },
   *         onDetails?: (id) => void   (default: open the asset in Asset Inventory),
   *         onSaved?: () => void,
   *         onClose?: () => void       (shows a Close button),
   *         showOpenLink?: boolean     (Dashboard: "Open in Asset Inventory →") }
   */
  function NeedsAttention(opts) {
    const cfg = MODES[opts.mode || 'missing'];
    const st = { rows: null, country: null, issue: '', site: '', type: '' };
    if (opts.initial) {
      if (opts.initial.country !== undefined && opts.initial.country !== null) st.country = opts.initial.country;
      st.site = opts.initial.site || '';
      st.type = opts.initial.type || '';
    }
    const root = opts.root;
    root.innerHTML = `
      <div class="card na-card">
        <div class="card-header" style="flex-wrap:wrap;gap:10px">
          <span class="card-title">${cfg.title} <span class="badge badge-broken" data-na="count" style="display:none;margin-left:6px"></span></span>
          <div class="seg" data-na="country" role="tablist" aria-label="Country"></div>
          ${opts.onClose ? '<button type="button" class="btn btn-ghost btn-sm" data-na="close" title="Back to the full list">✕ Close</button>' : ''}
        </div>
        <div class="na-bar">
          <select class="filter-select na-type" data-na="type" aria-label="Asset type"></select>
          <div class="seg seg-sm" data-na="site" role="tablist" aria-label="Site"></div>
          <div class="na-issues" data-na="issues"></div>
          ${opts.showOpenLink ? '<a class="btn btn-ghost btn-sm" data-na="open" href="/inventory.html">Open in Asset Inventory →</a>' : ''}
        </div>
        <div class="table-wrap" style="max-height:${opts.maxHeight || 380}px;overflow-y:auto">
          <table>
            <thead><tr><th>Asset</th><th>Country / Site</th><th>User</th><th>${opts.mode === 'ad' ? 'AD Name' : 'Missing'}</th><th></th></tr></thead>
            <tbody data-na="tbody"><tr><td colspan="5" class="empty-state">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>`;
    const $ = (k) => root.querySelector(`[data-na="${k}"]`);
    if (opts.onClose) $('close').addEventListener('click', opts.onClose);

    async function load() {
      try {
        if (!window.CURRENT_USER && typeof ensureAuth === 'function') await ensureAuth();
        const order = (c) => { const i = COUNTRIES.indexOf(c); return i < 0 ? COUNTRIES.length : i; };
        st.rows = (await cfg.load()).map(a => ({ ...a, _issues: cfg.issuesOf(a) })).filter(a => a._issues.length)
          .sort((x, y) => order(x.country) - order(y.country) || typeRank(x.asset_type) - typeRank(y.asset_type) || x.id - y.id);
        render();
      } catch (err) {
        console.error(err);
        $('tbody').innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load</td></tr>';
      }
    }

    function render() {
      if (!st.rows) return;
      const tbody = $('tbody');
      const userCountry = window.CURRENT_USER && window.CURRENT_USER.country;
      const country = userCountry || (st.country !== null ? st.country : (opts.scope ? opts.scope() : '')) || '';

      const badge = $('count');
      badge.textContent = `${fmt(st.rows.length)} to fix`;
      badge.style.display = st.rows.length ? '' : 'none';

      // Country tabs with counts.
      const tabs = $('country');
      const inCountry = (c) => st.rows.filter(a => !c || a.country === c);
      if (userCountry) {
        tabs.innerHTML = `<span class="seg-fixed">${esc(userCountry)}</span>`;
      } else {
        tabs.innerHTML = [['', 'All'], ...COUNTRIES.map(c => [c, c])].map(([v, label]) =>
          `<button type="button" role="tab" class="seg-btn${v === country ? ' active' : ''}" data-v="${v}" aria-selected="${v === country}">${label}<span class="seg-count">${fmt(inCountry(v).length)}</span></button>`).join('');
        tabs.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => {
          st.country = btn.dataset.v; st.issue = '';
          if (st.country && st.country !== SITE_COUNTRY) st.site = '';
          render();
        }));
      }

      // Office / Factory buttons (Vietnam only — shown for All and Vietnam).
      const siteEl = $('site');
      const showSite = !country || country === SITE_COUNTRY;
      if (!showSite) st.site = '';
      const inSite = (rows, site) => rows.filter(a => !site || (a.country === SITE_COUNTRY && a.location === site));
      const rowsCountry = inCountry(country);
      siteEl.style.display = showSite ? '' : 'none';
      siteEl.innerHTML = showSite ? [['', 'All sites'], ...SITES.map(x => [x, 'VN ' + x])].map(([v, label]) =>
        `<button type="button" role="tab" class="seg-btn${v === st.site ? ' active' : ''}" data-v="${v}" aria-selected="${v === st.site}">${label}<span class="seg-count">${fmt(inSite(rowsCountry, v).length)}</span></button>`).join('') : '';
      siteEl.querySelectorAll('.seg-btn').forEach(btn => btn.addEventListener('click', () => { st.site = btn.dataset.v; render(); }));

      // Asset type filter — Laptop / Desktop / Phone first, counts within country + site.
      const rowsSite = inSite(rowsCountry, st.site);
      const typeCounts = new Map();
      rowsSite.forEach(a => typeCounts.set(a.asset_type || '', (typeCounts.get(a.asset_type || '') || 0) + 1));
      const types = [...typeCounts.keys()].filter(Boolean)
        .sort((x, y) => typeRank(x) - typeRank(y) || typeCounts.get(y) - typeCounts.get(x));
      if (st.type && !typeCounts.has(st.type === '__none' ? '' : st.type)) st.type = '';
      const typeSel = $('type');
      typeSel.innerHTML = `<option value="">All asset types (${fmt(rowsSite.length)})</option>` +
        types.map(t => `<option value="${esc(t)}"${t === st.type ? ' selected' : ''}>${esc(t)} (${fmt(typeCounts.get(t))})</option>`).join('') +
        (typeCounts.has('') ? `<option value="__none"${st.type === '__none' ? ' selected' : ''}>Type not set (${fmt(typeCounts.get(''))})</option>` : '');
      typeSel.onchange = () => { st.type = typeSel.value; st.issue = ''; render(); };

      // Issue chips (counts within country + site + type) — click to filter.
      const rowsC = rowsSite.filter(a => !st.type || (st.type === '__none' ? !a.asset_type : a.asset_type === st.type));
      const issueCount = (t) => rowsC.filter(a => a._issues.includes(t)).length;
      const issuesEl = $('issues');
      issuesEl.innerHTML = cfg.issues.filter(t => issueCount(t)).map(t =>
        `<button type="button" class="na-chip${t === st.issue ? ' active' : ''}" data-v="${t}">${t}<b>${fmt(issueCount(t))}</b></button>`).join('')
        || '<span class="text-muted text-sm">Nothing to fix here.</span>';
      issuesEl.querySelectorAll('.na-chip').forEach(btn => btn.addEventListener('click', () => {
        st.issue = st.issue === btn.dataset.v ? '' : btn.dataset.v; render();
      }));
      if ($('open')) $('open').href = link({ [cfg.link]: '1', country: st.site ? SITE_COUNTRY : country,
        location: st.site, asset_type: st.type === '__none' ? '' : st.type });

      const rows = st.issue ? rowsC.filter(a => a._issues.includes(st.issue)) : rowsC;
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
          <svg width="36" height="36" fill="none" stroke="#22c55e" stroke-width="1.5" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <p>All assets${country ? ' in ' + esc(country) : ''} ${cfg.empty}</p></div></td></tr>`;
        return;
      }

      tbody.innerHTML = rows.map(a => {
        // Each missing field is an input you can fill right here (or a red tag when you can't edit it).
        let tagHtml = a._issues.filter(t => t !== 'Dup Serial').map(t => {
          const field = cfg.fields[t];
          const can = editable(a, field);
          const current = t === AD_UNMATCHED ? (a.ad_name || '') : '';
          const label = t === AD_UNMATCHED ? 'Not in User Inv.' : t === AD_MISSING ? 'AD Name' : t;
          const hint = t === AD_UNMATCHED ? 'This AD Name is not found in User Inventory (email before @) — correct it' : '';
          return can.ok
            ? `<label class="na-field" title="${esc(hint)}"><span>${label}</span><input data-field="${field}" data-orig="${esc(current)}" value="${esc(current)}" placeholder="Enter ${t === AD_MISSING || t === AD_UNMATCHED ? 'AD Name' : t}" autocomplete="off"></label>`
            : `<span class="badge badge-broken" title="${esc(can.why)}" style="margin:1px;font-size:10.5px;padding:2px 6px">${label}${current ? ': ' + esc(current) : ''}</span>`;
        }).join('');
        if (a.dup_serial) {
          const others = (a.dup_with || []).map(o => o.asset_code || `#${o.id}`).join(', ');
          const title = others ? `Same serial "${a.serial_no}" as: ${others}` : `Duplicate serial "${a.serial_no}"`;
          tagHtml += `<span class="badge" title="${esc(title)}" style="margin:1px;font-size:10.5px;padding:2px 6px;background:#fde68a;color:#92400e">Dup Serial: ${esc(a.serial_no || '?')}</span>`;
        }
        const hasInputs = tagHtml.includes('data-field=');
        const label = a.brand_model || a.user_name || a.department || `Asset #${a.id}`;
        const site = a.country === SITE_COUNTRY && SITES.includes(a.location) ? ` · ${a.location}` : '';
        return `
          <tr data-id="${a.id}">
            <td style="min-width:140px">
              <div class="truncate" title="${esc(label)}" style="max-width:220px">${esc(label)}</div>
              <span class="text-muted text-sm">#${a.id}${a.asset_type ? ' · ' + esc(a.asset_type) : ''}</span>
            </td>
            <td class="text-sm">${esc(a.country || '—')}<span class="text-muted">${site}</span></td>
            <td class="text-sm">${esc(a.user_name || '—')}</td>
            <td><div class="na-fields">${tagHtml}</div></td>
            <td style="text-align:right;white-space:nowrap">
              ${hasInputs ? '<button type="button" class="btn btn-primary btn-sm na-save">Save</button>' : ''}
              <button type="button" class="btn btn-ghost btn-sm na-details" title="Open the full edit form">Details</button>
            </td>
          </tr>`;
      }).join('');

      tbody.querySelectorAll('tr[data-id]').forEach(tr => {
        tr.querySelector('.na-details').addEventListener('click', () =>
          (opts.onDetails ? opts.onDetails(Number(tr.dataset.id)) : (window.location.href = `/inventory.html?edit=${tr.dataset.id}`)));
        const btn = tr.querySelector('.na-save');
        if (!btn) return;
        btn.addEventListener('click', () => save(tr));
        tr.querySelectorAll('input[data-field]').forEach(i => i.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); save(tr); }
        }));
      });
    }

    // Save the values typed in one row (merged into the full record → normal PUT rules apply).
    async function save(tr) {
      const id = tr.dataset.id;
      const inputs = [...tr.querySelectorAll('input[data-field]')]
        .filter(i => i.value.trim() && i.value.trim() !== (i.dataset.orig || ''));
      if (!inputs.length) { showToast('Type the missing value first', 'error'); return; }
      const btn = tr.querySelector('.na-save');
      btn.disabled = true;
      try {
        const row = await apiGet(`/api/assets/${id}`);
        inputs.forEach(i => { row[i.dataset.field] = i.value.trim(); });
        await apiPut(`/api/assets/${id}`, row);
        showToast(`Saved #${id}`);
        await load();
        if (opts.onSaved) opts.onSaved();
      } catch (err) {
        let msg = 'Could not save';
        try { msg = JSON.parse(err.message).error || msg; } catch {}
        showToast(msg, 'error');
        btn.disabled = false;
      }
    }

    load();
    return {
      reload: load,
      render,
      // Follow the page's country again (Dashboard switch) and clear the sub-filters.
      followScope() { st.country = null; st.issue = ''; render(); },
    };
  }

  window.NeedsAttention = NeedsAttention;
})();
