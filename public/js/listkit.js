/* ListKit (docs/UX-REDESIGN.md, phase 3): the shared list pattern, used page by page.
   - Side panel: <div class="modal-overlay" data-drawer> opens on the right on a desktop, the list stays visible and
     usable (click another row → the panel shows that one). Phones keep the full-screen sheet. Esc closes.
   - More filters: <button data-lk-more="#id"> shows / hides a second filter row and counts the filters set in it.
   - Saved views: ListKit.savedViews({ key, mount, fields, get, set, apply }) → "Views ▾" menu stored in this browser.
   - Bulk actions: ListKit.bulk({ tbody, all, actions }) → checkboxes .lk-sel[data-id] + a bar at the bottom. */
(function () {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── Side panel ─────────────────────────────────────────────────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.modal-overlay[data-drawer].open')].pop();
    if (open && !document.querySelector('.modal-overlay.open:not([data-drawer])')) open.classList.remove('open');
  });

  // One side panel at a time: opening one (e.g. View → Edit) closes the other.
  document.addEventListener('DOMContentLoaded', () => {
    const ds = [...document.querySelectorAll('.modal-overlay[data-drawer]')];
    ds.forEach(d => new MutationObserver(() => {
      if (d.classList.contains('open') && !d.dataset.lkWas) ds.forEach(o => { if (o !== d) o.classList.remove('open'); });
      d.dataset.lkWas = d.classList.contains('open') ? '1' : '';
    }).observe(d, { attributes: true, attributeFilter: ['class'] }));
  });

  // ── More filters ───────────────────────────────────────────────────────────────────────────────────────
  function initMore() {
    document.querySelectorAll('[data-lk-more]').forEach(btn => {
      if (btn.dataset.lkDone) return; btn.dataset.lkDone = '1';
      const row = document.querySelector(btn.dataset.lkMore);
      if (!row) return;
      const count = () => {
        const n = [...row.querySelectorAll('select, input')].filter(el => el.value && !el.dataset.lkIgnore && el.style.display !== 'none').length;
        const b = btn.querySelector('.lk-n'); if (b) { b.textContent = n || ''; b.hidden = !n; }
      };
      const key = 'lk-more:' + location.pathname;
      try { if (localStorage.getItem(key) === '1') row.hidden = false; } catch { /* ignore */ }
      btn.setAttribute('aria-expanded', String(!row.hidden));
      btn.addEventListener('click', () => {
        row.hidden = !row.hidden; btn.setAttribute('aria-expanded', String(!row.hidden));
        try { localStorage.setItem(key, row.hidden ? '0' : '1'); } catch { /* ignore */ }
        count();
      });
      row.addEventListener('change', count);
      setInterval(count, 1500);   // values also change from code (Reset, saved views, URL filters)
      count();
    });
  }
  document.addEventListener('DOMContentLoaded', initMore);

  // ── Saved views ────────────────────────────────────────────────────────────────────────────────────────
  // fields: element ids whose .value is saved; get()/set(v) for anything else; apply() reloads the list.
  function savedViews({ key, mount, fields, get, set, apply }) {
    const host = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!host) return;
    const K = 'lk-views:' + key;
    const load = () => { try { return JSON.parse(localStorage.getItem(K) || '[]'); } catch { return []; } };
    const store = (l) => { try { localStorage.setItem(K, JSON.stringify(l)); } catch { /* ignore */ } };
    host.classList.add('lk-views');
    host.innerHTML = '<button type="button" class="btn btn-ghost btn-sm lk-views-b" aria-haspopup="menu">★ Views ▾</button><div class="lk-views-m" role="menu" hidden></div>';
    const b = host.querySelector('.lk-views-b'), m = host.querySelector('.lk-views-m');
    const snapshot = () => ({ f: Object.fromEntries(fields.map(id => [id, (document.getElementById(id) || {}).value || ''])), x: get ? get() : null });
    const render = () => {
      const list = load();
      m.innerHTML = (list.length ? list.map((v, i) => `<div class="lk-v"><button type="button" data-i="${i}" role="menuitem">${esc(v.name)}</button><button type="button" class="lk-v-x" data-x="${i}" title="Delete this view" aria-label="Delete ${esc(v.name)}">✕</button></div>`).join('')
        : '<div class="lk-v-empty">No saved views yet.</div>')
        + '<button type="button" class="lk-v-save" role="menuitem">＋ Save the current filters as a view…</button>';
    };
    b.addEventListener('click', (e) => { e.stopPropagation(); render(); m.hidden = !m.hidden; });
    document.addEventListener('click', (e) => { if (!host.contains(e.target)) m.hidden = true; });
    m.addEventListener('click', async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      const list = load();
      if (t.classList.contains('lk-v-save')) {
        const name = (prompt('Name of this view (e.g. "Broken laptops · Factory"):') || '').trim().slice(0, 60);
        if (!name) return;
        const i = list.findIndex(v => v.name.toLowerCase() === name.toLowerCase());
        const v = { name, ...snapshot() };
        if (i >= 0) list[i] = v; else list.push(v);
        store(list); render(); if (typeof showToast === 'function') showToast(`View "${name}" saved`);
        return;
      }
      if (t.dataset.x != null) { list.splice(Number(t.dataset.x), 1); store(list); render(); return; }
      const v = list[Number(t.dataset.i)]; if (!v) return;
      m.hidden = true;
      for (const [id, val] of Object.entries(v.f || {})) { const el = document.getElementById(id); if (el) el.value = val; }
      if (set) await set(v.x, v.f);
      apply();
      if (typeof showToast === 'function') showToast(`View "${v.name}"`);
    });
  }

  // ── Bulk actions ───────────────────────────────────────────────────────────────────────────────────────
  // actions: [{ label, danger?, run: async (ids) => void }] · all: checkbox in the header that (un)selects the page.
  function bulk({ tbody, all, actions, noun = 'item' }) {
    const body = typeof tbody === 'string' ? document.querySelector(tbody) : tbody;
    const allBox = typeof all === 'string' ? document.querySelector(all) : all;
    if (!body) return null;
    const sel = new Set();
    const bar = document.createElement('div');
    bar.className = 'lk-bulk'; bar.hidden = true;
    bar.innerHTML = `<b class="lk-bulk-n"></b>${actions.map((a, i) => `<button type="button" class="btn btn-sm${a.danger ? ' lk-danger' : ''}" data-a="${i}">${esc(a.label)}</button>`).join('')}
      <span class="lk-bulk-sp"></span><button type="button" class="btn btn-sm lk-bulk-clear">Clear (Esc)</button>`;
    document.body.appendChild(bar);
    const sync = () => {
      body.querySelectorAll('.lk-sel').forEach(c => { c.checked = sel.has(c.dataset.id); c.closest('tr') && c.closest('tr').classList.toggle('lk-on', c.checked); });
      const boxes = [...body.querySelectorAll('.lk-sel')];
      if (allBox) { allBox.checked = boxes.length > 0 && boxes.every(c => c.checked); allBox.indeterminate = !allBox.checked && boxes.some(c => c.checked); }
      bar.hidden = !sel.size;
      bar.querySelector('.lk-bulk-n').textContent = `${sel.size} ${noun}${sel.size === 1 ? '' : 's'} selected`;
    };
    body.addEventListener('change', (e) => { const c = e.target.closest('.lk-sel'); if (!c) return; if (c.checked) sel.add(c.dataset.id); else sel.delete(c.dataset.id); sync(); });
    body.addEventListener('click', (e) => { if (e.target.closest('.lk-sel')) e.stopPropagation(); }, true);
    if (allBox) allBox.addEventListener('change', () => { body.querySelectorAll('.lk-sel').forEach(c => { if (allBox.checked) sel.add(c.dataset.id); else sel.delete(c.dataset.id); }); sync(); });
    const clear = () => { sel.clear(); sync(); };
    bar.querySelector('.lk-bulk-clear').addEventListener('click', clear);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel.size && !document.querySelector('.modal-overlay.open')) clear(); });
    bar.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-a]'); if (!t) return;
      const a = actions[Number(t.dataset.a)];
      bar.querySelectorAll('button').forEach(x => { x.disabled = true; });
      try { await a.run([...sel].map(Number)); } finally { bar.querySelectorAll('button').forEach(x => { x.disabled = false; }); }
    });
    // Re-check the boxes after the list is drawn again (paging, filters).
    new MutationObserver(sync).observe(body, { childList: true });
    return { clear, ids: () => [...sel].map(Number), sync };
  }

  // Run fn on each id, a few at a time, with a progress toast. → { ok, failed: [{ id, error }] }
  async function each(ids, fn, label) {
    const failed = []; let ok = 0, i = 0;
    const worker = async () => { while (i < ids.length) { const id = ids[i++]; try { await fn(id); ok++; } catch (e) { let m = 'failed'; try { m = JSON.parse(e.message).error || m; } catch { m = e.message || m; } failed.push({ id, error: m }); } } };
    await Promise.all([worker(), worker(), worker()]);
    if (typeof showToast === 'function') showToast(`${label}: ${ok} done${failed.length ? `, ${failed.length} not changed` : ''}`, failed.length ? 'error' : undefined);
    if (failed.length) alert(`${failed.length} not changed:\n\n` + failed.slice(0, 15).map(f => `#${f.id}: ${f.error}`).join('\n') + (failed.length > 15 ? `\n… and ${failed.length - 15} more` : ''));
    return { ok, failed };
  }

  // A small chooser dialog: ListKit.choose('Set status', ['Active', 'Broken', 'Stock']) → value or null.
  function choose(title, options, note) {
    return new Promise((resolve) => {
      const ov = document.createElement('div');
      ov.className = 'modal-overlay open';
      ov.innerHTML = `<div class="modal" style="max-width:380px"><div class="modal-header"><span class="modal-title">${esc(title)}</span><button class="modal-close" data-c>✕</button></div>
        <div class="modal-body"><select class="form-control" id="lk-choose">${options.map(o => `<option>${esc(o)}</option>`).join('')}</select>${note ? `<p class="text-muted text-sm" style="margin-top:8px">${esc(note)}</p>` : ''}</div>
        <div class="modal-footer"><button class="btn btn-ghost" data-c>Cancel</button><button class="btn btn-primary" data-ok>Apply</button></div></div>`;
      document.body.appendChild(ov);
      const done = (v) => { ov.remove(); resolve(v); };
      ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-c]')) done(null); if (e.target.closest('[data-ok]')) done(ov.querySelector('#lk-choose').value); });
    });
  }

  // CSV download of rows: cols = [[header, row => value], …]
  function csv(name, rows, cols) {
    const q = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = '﻿' + [cols.map(c => q(c[0])).join(','), ...rows.map(r => cols.map(c => q(c[1](r))).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  window.ListKit = { savedViews, bulk, each, choose, csv, initMore };
})();
