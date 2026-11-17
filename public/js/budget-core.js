/* Budget core — shared by the browser (Budget page import) and Node
   (routes/budget.js, scripts). No dependencies: works on a header:1 matrix
   (array of rows) produced by SheetJS.

   Understands the three corporate workbook layouts:
     • B-F report  (DT_…_B-F_RAPOR → sheet "RAPOR_HEPSİ"): several years in one
       row — B_Mon-YY budget, A_Mon-YY actual, F_Mon-YY forecast, each in
       BPB / TRY / USD / EUR blocks (we keep USD), plus "… Açıklama" comments.
     • Approved budget (2027_BUDGET_… → sheet "2027 Vietnam"): B_Mon-27 only.
     • Legacy budget 2026.xlsx (Sheet1) and this app's own export.

   Output: one item per (line, year):
     { country, year, kind, status, company, department, owner,
       proj_group, proj_category, program, project, sub_project, oc,
       gl_no, gl_name, cc_no, cc_name, proje_no, proje_name,
       pyp_ecc, pyp_ecc_name, pyp_s4, pyp_s4_name,
       budget[12], actual[12], actual_months, comment }
   `actual` = actual for the first `actual_months` months, forecast after.
   PYP: "PYP No" = old ECC code · "PYP öğesi (Yeni Yapı)" = new S/4HANA code. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgetCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COUNTRIES = ['Vietnam', 'Thailand', 'Malaysia'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MON_IDX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  // Turkish letters → ASCII (keeps case), then normalized lowercase key.
  function fold(s) {
    return String(s == null ? '' : s)
      .replace(/İ/g, 'I').replace(/ı/g, 'i').replace(/Ş/g, 'S').replace(/ş/g, 's')
      .replace(/Ğ/g, 'G').replace(/ğ/g, 'g').replace(/Ü/g, 'U').replace(/ü/g, 'u')
      .replace(/Ö/g, 'O').replace(/ö/g, 'o').replace(/Ç/g, 'C').replace(/ç/g, 'c')
      .replace(/ /g, ' ');
  }
  const norm = (s) => fold(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const sum = (a) => r2((a || []).reduce((s, x) => s + (Number(x) || 0), 0));
  const txt = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());

  function countryOf(v) {
    const u = fold(v).toUpperCase();
    if (/VIETNAM|\bVN\d|^VN/.test(u)) return 'Vietnam';
    if (/THAILAND|TAYLAND|\bTH\d|^TH/.test(u)) return 'Thailand';
    if (/MALAYSIA|MALEZYA|\bMY\d|^MY/.test(u)) return 'Malaysia';
    return null;
  }

  // Normalized header → field. First matching column wins (except company: all kept).
  const DIM = {
    'durum': 'status', 'butce sahibi': 'owner', 'mudurluk': 'department',
    'proje grubu': 'proj_group', 'proje kategorisi': 'proj_category',
    'program servis adi': 'program', 'proje servis adi': 'project', 'alt proje servis adi': 'sub_project',
    'opex capex': 'oc', 'o c': 'oc',
    'masraf cesidi': 'gl_no', 'mc no': 'gl_no', 'mc tanimi': 'gl_name',
    'my no': 'cc_no', 'my tanimi': 'cc_name',
    'proje no': 'proje_no', 'proje tanim': 'proje_name', 'proje tanimi': 'proje_name',
    'pyp no': 'pyp_ecc', 'pyp tanim': 'pyp_ecc_name',
    'pyp ogesi yeni yapi': 'pyp_s4', 'ad yeni yapi': 'pyp_s4_name',
    // this app's export
    'country': 'country', 'pyp ecc old': 'pyp_ecc', 'pyp ecc old name': 'pyp_ecc_name',
    'pyp s4 new': 'pyp_s4', 'pyp s4 new name': 'pyp_s4_name',
  };

  // Map a header row (+ the super-header row above it, which carries the
  // currency block labels like "BUDGET 2026_USD"). Returns null if not a budget sheet.
  function mapColumns(header, above) {
    const dim = {}, companies = [];
    const years = {};      // year → { b:[12], a:[12], f:[12] } column indexes
    const comments = {};   // year → column
    let y2025total = -1;
    const blockLabel = (i) => {
      if (!above) return '';
      for (let j = i; j >= 0; j--) { const v = txt(above[j]); if (v) return v.toUpperCase(); }
      return '';
    };
    header.forEach((h, i) => {
      const n = norm(h);
      if (!n) return;
      if (n === 'sirket tanimi' || n === 'company') { companies.push(i); return; }
      if (DIM[n] && dim[DIM[n]] === undefined) { dim[DIM[n]] = i; return; }
      if (n === '2025 a usd' || n === '2025 actual') { if (y2025total < 0) y2025total = i; return; }
      if (/aciklama|comment/.test(n)) {
        if (/\ben$/.test(n)) return;                                  // our export's English copy
        const m = String(h).match(/(20\d\d)/);
        if (m) (comments[+m[1]] = comments[+m[1]] || []).push(i);   // several per year (mid-year + yearly) → joined
        return;
      }
      const m = n.match(/^([baf]) ([a-z]{3}) (\d\d)(?: (usd|try|eur|bpb))?$/);
      if (!m || MON_IDX[m[2]] === undefined) return;
      const cur = m[4] || '';
      if (cur && cur !== 'usd') return;
      const lbl = blockLabel(i);
      if (!cur && /(_|\s)(BPB|TRY|EUR)\b/.test(lbl)) return;   // other-currency block
      const y = 2000 + Number(m[3]);
      const Y = years[y] = years[y] || { b: Array(12).fill(-1), a: Array(12).fill(-1), f: Array(12).fill(-1) };
      const slot = Y[m[1]];
      if (slot[MON_IDX[m[2]]] < 0) slot[MON_IDX[m[2]]] = i;
    });
    if (dim.proj_group === undefined) return null;
    if (!Object.keys(years).some(y => years[y].b.some(i => i >= 0))) return null;
    return { dim, companies, years, comments, y2025total };
  }

  const isCapex = (oc, gl) => /CAPEX/i.test(oc) || /MC_CAPEX/i.test(gl) || /^84/.test(String(gl));

  // Turn one sheet (header:1 matrix) into items. `ctx`: { sheetName, fileName }.
  function parseRows(rows, ctx) {
    ctx = ctx || {};
    let map = null, hr = -1;
    for (let h = 0; h < Math.min(10, rows.length); h++) {
      map = mapColumns(rows[h] || [], h > 0 ? rows[h - 1] : null);
      if (map) { hr = h; break; }
    }
    if (!map) return null;
    const { dim, companies, years, comments } = map;
    const at = (r, i) => (i >= 0 && i < r.length ? r[i] : '');
    const get = (r, f) => (dim[f] === undefined ? '' : txt(at(r, dim[f])));
    const fallbackCountry = countryOf(ctx.sheetName || '') || countryOf(ctx.fileName || '');
    const yearList = Object.keys(years).map(Number).sort();
    // Report = has actual/forecast columns; approved budget = budget only.
    const hasActuals = yearList.some(y => years[y].a.some(i => i >= 0) || years[y].f.some(i => i >= 0));
    const legacy = dim.pyp_s4 === undefined && dim.oc !== undefined && header(rows, hr).some(h => norm(h) === 'o c');
    const kind = legacy ? 'legacy' : hasActuals ? 'report' : 'approved';
    const out = [];
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (!get(r, 'proj_group') && !get(r, 'pyp_ecc') && !get(r, 'gl_no')) continue;
      let country = dim.country !== undefined ? countryOf(get(r, 'country')) : null;
      for (const c of companies) { if (country) break; country = countryOf(at(r, c)); }
      if (!country) country = fallbackCountry;
      if (!country) continue;
      const company = companies.map(c => txt(at(r, c))).filter(Boolean).filter((v, k, a) => a.indexOf(v) === k).join(' / ');
      const base = {
        country, status: get(r, 'status'), company, department: get(r, 'department'), owner: get(r, 'owner'),
        proj_group: get(r, 'proj_group'), proj_category: get(r, 'proj_category'), program: get(r, 'program'),
        project: get(r, 'project'), sub_project: get(r, 'sub_project'),
        oc: get(r, 'oc').toUpperCase(), gl_no: get(r, 'gl_no'), gl_name: get(r, 'gl_name'),
        cc_no: get(r, 'cc_no'), cc_name: get(r, 'cc_name'), proje_no: get(r, 'proje_no'), proje_name: get(r, 'proje_name'),
        pyp_ecc: get(r, 'pyp_ecc'), pyp_ecc_name: get(r, 'pyp_ecc_name'), pyp_s4: get(r, 'pyp_s4'), pyp_s4_name: get(r, 'pyp_s4_name'),
      };
      if (base.oc !== 'CAPEX' && base.oc !== 'OPEX') base.oc = isCapex(base.oc, base.gl_no) ? 'CAPEX' : 'OPEX';
      for (const y of yearList) {
        const Y = years[y];
        const budget = Y.b.map(c => r2(at(r, c)));
        const actual = Y.a.map((c, k) => r2(c >= 0 ? at(r, c) : at(r, Y.f[k])));
        const actual_months = Y.a.reduce((n, c, k) => (c >= 0 ? k + 1 : n), 0);
        const comment = (comments[y] || []).map(c => txt(at(r, c))).filter((v, k, a) => v && a.indexOf(v) === k).join(' · ');
        const hasNums = budget.some(v => v) || actual.some(v => v);
        if (!hasNums && !comment) continue;
        out.push(Object.assign({}, base, { year: y, kind, budget, actual, actual_months, comment }));
      }
    }
    return out;
  }
  function header(rows, hr) { return rows[hr] || []; }

  // Pick the sheet(s) to read from a workbook's sheet list.
  //   sheets: [{ name, hidden }]  → ordered candidate names
  function candidateSheets(sheets) {
    const hepsi = sheets.filter(s => norm(s.name) === 'rapor hepsi');
    if (hepsi.length) return hepsi.map(s => s.name);
    const visible = sheets.filter(s => !s.hidden);
    const score = (n) => (/^20\d\d /.test(n) ? 0 : /sheet1|budget|rapor/i.test(n) ? 1 : 2);
    return visible.map(s => s.name).sort((a, b) => score(a) - score(b));
  }

  // Parse a whole workbook with a sheet reader: readSheet(name) → header:1 rows.
  // Stops at the first sheet that yields data, except this app's own export
  // ("Budget 2026", "Budget 2027", …) where every year sheet is read.
  function parseWorkbook(sheets, readSheet, fileName) {
    const found = [];
    const used = [];
    const isExport = (n) => /^budget 20\d\d$/i.test(n);
    for (const name of candidateSheets(sheets)) {
      if (used.length && !(isExport(name) && used.every(isExport))) break;
      let rows; try { rows = readSheet(name); } catch (e) { continue; }
      const items = parseRows(rows, { sheetName: name, fileName });
      if (items && items.length) { found.push(...items); used.push(name); }
    }
    if (!found.length) throw new Error('No budget sheet found in ' + (fileName || 'file') +
      ' (need Proje Grubu + monthly B_Mon-YY columns, e.g. sheet "RAPOR_HEPSİ" or "2027 Vietnam").');
    return { items: found, sheets: used };
  }

  // Parse a workbook with SheetJS, reading one sheet at a time (the corporate
  // reports are ~30 MB with dozens of hidden helper sheets — never load them all).
  // type: 'array' (browser ArrayBuffer) or 'buffer' (Node Buffer).
  function parseWithXLSX(XLSX, data, type, fileName) {
    const meta = XLSX.read(data, { type, sheets: ['\u0000none'], dense: true });   // workbook info only
    const info = (meta.Workbook && meta.Workbook.Sheets) || [];
    const sheets = meta.SheetNames.map((name, i) => ({ name, hidden: !!(info[i] && info[i].Hidden) }));
    const read = (name) => {
      const wb = XLSX.read(data, { type, sheets: [name], dense: true, cellFormula: false, cellHTML: false, cellText: false });
      return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    };
    // Local Finance control (IT_Opex_Control_Table_<Mon><YY>.xlsb): sheet "SAP data".
    const sap = sheets.find(sh => norm(sh.name) === 'sap data');
    if (sap) {
      const finance = parseFinanceRows(read(sap.name), { fileName });
      if (finance) {
        if (!finance.length) throw new Error('No IT postings (PIC = IT) found in ' + (fileName || 'file') + ' — sheet "SAP data".');
        return { items: [], finance, sheets: [sap.name], source: 'finance' };
      }
    }
    return Object.assign(parseWorkbook(sheets, read, fileName), { source: 'turkey' });
  }

  // ── Local Finance control (SAP line items) ────────────────────────────────
  // Same SAP postings as the Turkey B-F report, but grouped by the local GL /
  // "New Account Hierarchy" instead of Masraf Çeşidi + PYP. Only PIC = IT rows.
  // Each monthly file holds every month so far (earlier months may be restated).
  const FIN_COLS = {
    'period': 'period', 's4 gl': 's4_gl', 'cost element': 'local_gl', 'cost element descr': 'gl_desc',
    's4 cost center': 's4_cc', 'cost center': 'cc', 'co object name': 'cc_name', 'document type': 'doc_type',
    'document number': 'doc_no', 'posting date': 'posting_date', 'document header text': 'header_text',
    'reference': 'reference', 'currency': 'currency', 'value in obj crcy': 'amount', 'val coarea crcy': 'usd',
    'name': 'text', 'order': 'io', 'cost element type': 'cost_type', 'new cost element group': 'cost_group',
    'pl criteria': 'pl_criteria', 'department': 'department', 'year': 'year', 'group v r': 'group_vr',
    'io name': 'io_name', 'review note': 'review_note', 'type of expense': 'expense_type', 'pic': 'pic',
    'budget actual': 'kind',
  };
  const xlDate = (v) => {
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return d.toISOString().slice(0, 10);
    }
    return txt(v);
  };
  function parseFinanceRows(rows, ctx) {
    ctx = ctx || {};
    let hr = -1, col = null;
    for (let h = 0; h < Math.min(6, rows.length); h++) {
      const m = {};
      (rows[h] || []).forEach((v, i) => { const k = FIN_COLS[norm(v)]; if (k && m[k] === undefined) m[k] = i; });
      if (m.amount !== undefined && m.kind !== undefined && m.pic !== undefined && m.period !== undefined) { hr = h; col = m; break; }
    }
    if (!col) return null;
    const get = (r, k) => (col[k] === undefined ? '' : r[col[k]]);
    const fm = String(ctx.fileName || '').match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[\s_-]*(\d{2})(?!\d)/i);
    const fileYear = fm ? 2000 + Number(fm[2]) : 0;
    const out = [];
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      if (norm(get(r, 'pic')) !== 'it') continue;
      const kindRaw = norm(get(r, 'kind'));
      const kind = kindRaw === 'budget' ? 'Budget' : kindRaw === 'actual' ? 'Actual' : kindRaw ? 'Adj' : 'Actual';
      const period = Math.floor(Number(get(r, 'period')) || 0);
      if (period < 1 || period > 12) continue;
      const country = countryOf(get(r, 'group_vr')) || countryOf(get(r, 'cc')) || countryOf(ctx.fileName || '');
      if (!country) continue;
      out.push({
        country, year: Number(get(r, 'year')) || fileYear, period, kind,
        s4_gl: txt(get(r, 's4_gl')), local_gl: txt(get(r, 'local_gl')), gl_desc: txt(get(r, 'gl_desc')),
        s4_cc: txt(get(r, 's4_cc')), cc: txt(get(r, 'cc')), cc_name: txt(get(r, 'cc_name')),
        doc_type: txt(get(r, 'doc_type')), doc_no: txt(get(r, 'doc_no')), posting_date: xlDate(get(r, 'posting_date')),
        header_text: txt(get(r, 'header_text')), text: txt(get(r, 'text')), currency: txt(get(r, 'currency')) || 'VND',
        amount: r2(get(r, 'amount')), usd: r2(get(r, 'usd')),
        cost_type: txt(get(r, 'cost_type')), cost_group: txt(get(r, 'cost_group')), pl_criteria: txt(get(r, 'pl_criteria')),
        department: txt(get(r, 'department')), expense_type: txt(get(r, 'expense_type')),
        io_name: txt(get(r, 'io_name')), review_note: txt(get(r, 'review_note')),
      });
    }
    // Budget rows carry no year; use the year of the actuals (or the file name).
    const yrs = out.filter(p => p.year).map(p => p.year);
    const y0 = yrs.length ? Math.max(...yrs) : fileYear;
    out.forEach(p => { if (!p.year) p.year = y0; });
    return out.filter(p => p.year);
  }

  // Summary per (country, year) for an import preview.
  function summarize(items) {
    const g = {};
    for (const it of items) {
      const k = it.country + '|' + it.year;
      const s = g[k] = g[k] || { country: it.country, year: it.year, kind: it.kind, lines: 0, budget: 0, actual: 0, actual_months: 0, comments: 0 };
      s.lines++; s.budget += sum(it.budget); s.actual += sum(it.actual);
      s.actual_months = Math.max(s.actual_months, it.actual_months || 0);
      if (it.comment) s.comments++;
    }
    return Object.values(g).map(s => Object.assign(s, { budget: r2(s.budget), actual: r2(s.actual) }))
      .sort((a, b) => a.country.localeCompare(b.country) || a.year - b.year);
  }

  // ── Turkish → English ─────────────────────────────────────────────────────
  // Whole-phrase translations (key = folded, upper-case, single-spaced).
  const PHRASES = {
    'FIILI_EK': 'Unbudgeted actual', 'FIILI EK': 'Unbudgeted actual', 'YENI TURETME': 'New derivation',
    'ALT YAPI & GUVENLIK URUNLERI': 'Infrastructure & Security Products',
    'SISTEM VE URETIM UYG.': 'System & Production Apps', 'SERVIS': 'Service',
    'OT NETWORK RENOVASYON': 'OT Network Renovation', 'VIETNAM HK OT RENEVASYON': 'Vietnam HK OT Renovation',
    'BILGI GUVENLIGI': 'Information Security', 'BILGI TEKNOLOJILERI': 'Information Technologies',
    'BILGI ISLEM': 'IT', 'ANA VERI': 'Master Data', 'K.K.E.G': 'Non-deductible expenses (KKEG)',
    'AIDAT, ABONELIK': 'Dues, Subscriptions', 'TEMSIL AGIRLAMA': 'Representation & Hospitality',
    'YAS.YUK. SSK PRIMI': 'Statutory social security premium', 'ISSIZLIK SIGORTA PRIMI': 'Unemployment insurance premium',
    'HABERLESME-SANTRAL FCT': 'Communication - PBX/Landline invoice', 'HABERLESME - TEL. SA': 'Communication - Telephone switchboard',
    'CESITLI BURO GIDERLE': 'Miscellaneous office expenses', 'BURO GID.-CES.GIDERLER': 'Office exp. - Miscellaneous',
    'YOL.VE SEYH.GID. - Y': 'Travel expenses', 'MEAL EXP\'S': 'Meal expenses',
    'PERS.-KORUYUCU MLZ.VE IS KIYAFET': 'Personnel - Protective equipment & workwear',
    'YEMEKHANE MALZEMESI VE DIGER': 'Canteen supplies & other', 'FAZLA MESAI YOL&YEMEK': 'Overtime transport & meals',
    'DEGERSIZ DEMIRBAS GID.': 'Low-value fixed asset expenses', 'EMSAL DAVA ODEMELERI': 'Precedent lawsuit payments',
    'BUTCE PB': 'Budget currency',
    // comments seen in the 2026 B-F reports
    'MONITOR VE SUNUM EKRANI ALIMLARI': 'Monitor and presentation screen purchases',
    'DESTEGI BITEN VXRAIL SUNUCU DEGISIMLERI': 'Replacement of VxRail servers whose support has ended',
    'FABRIKA IT STORAGE DEGISIMI': 'Factory IT storage replacement',
    'DD YENILEMELERI': 'DD (Data Domain) renewals',
  };
  // Word / short-phrase translations (longest match first).
  const WORDS = {
    'BILGI ISLEM': 'IT', 'CEP TELEFON': 'Mobile phone', 'INTERNET DATA': 'Internet data',
    'YURT ICI SEYAHAT': 'Domestic travel', 'YURT DISI SEYAHAT': 'Foreign travel', 'YURTDISI SEYAHAT': 'Foreign travel',
    'YI SEYAHAT': 'Domestic travel', 'YD SEYAHAT': 'Foreign travel', 'UCAK BILETI': 'Flight ticket',
    'ARAC KIRA': 'Car rental', 'OGS, HGS': 'Toll fees', 'OGS HGS': 'Toll fees', 'HGS OGS': 'Toll fees',
    'SOSYAL AKTIVITE': 'Social activity', 'SOS.AKT.': 'Social act.', 'IC ILETISIM': 'Internal communication',
    'SOSYAL YARDIM': 'Social benefit', 'DISARDAN TEDAVI': 'External medical treatment', 'DOGUM OLUM': 'Birth / death',
    'ESNEK YAN HAKLAR': 'Flexible benefits', 'HEDIYE CEK': 'Gift voucher', 'NORMAL MESAI': 'Regular hours',
    'FAZLA MESAI': 'Overtime', 'IKRAMIYE VE PRIM': 'Bonus & premium', 'SIGORTA GID.': 'Insurance exp.',
    'FERDI KAZA': 'Personal accident', 'PERS.GID': 'Personnel exp.', 'YEMEK FISI': 'Meal voucher',
    'IHBAR TAZMINATI': 'Notice pay', 'KIDEM TAZMINATI': 'Severance pay', 'DAMGA VERGISI': 'Stamp duty',
    'RESIM VE HARCLAR': 'Duties & fees', 'YAKIT GIDERI': 'Fuel expense', 'KIRA GIDERLERI': 'Rental expenses',
    'BAK.ONR.': 'Maint./Repair', 'BINA TESIS': 'Building & facility', 'MAKINE TECHIZAT': 'Machinery & equipment',
    'TASIT ARAC': 'Vehicles', 'BAKIM ONARIM': 'Maintenance & repair', 'BAKIM TAMIR': 'Maintenance & repair',
    'SEMINER VE KONFERANS': 'Seminar & conference', 'NAKLIYE GIDERLERI': 'Freight expenses',
    'FASON ISCILIK GIDERLERI': 'Subcontracted labour expenses', 'FOTOKOPI GIDERLERI': 'Photocopy expenses',
    'BURO GID.': 'Office exp.', 'BURO GIDERLERI': 'Office expenses', 'KARGO&KURYE': 'Cargo & courier',
    'PROJE YONETIMI': 'Project management', 'RISK YONETIMI': 'Risk management', 'ZAMAN YONETIMI': 'Time management',
    'TEDARIKCI YONETIMI': 'Supplier management', 'TALEP YONETIMI': 'Demand management', 'DEGISIM YONETIMI': 'Change management',
    'STOK VE TEDARIK ZINCIRI': 'Stock & supply chain', 'SATIS VE PAZARLAMA': 'Sales & marketing',
    'RAPORLAMA VE VERI ANALITIGI': 'Reporting & data analytics', 'VERI ANALITIGI': 'Data analytics',
    'INOVASYON VE URUN GELISTIRME': 'Innovation & product development', 'ERP KURULUMLARI': 'ERP implementations',
    'UYUMLULUK VE REGULASYON': 'Compliance & regulation', 'INSAN KAYNAKLARI': 'Human resources',
    'YAPAY ZEKA': 'AI', 'ISE ALIM': 'Recruitment', 'ALT YAPI': 'Infrastructure', 'GUVENLIK URUNLERI': 'Security products',
    'NUMUNE TAKIBI': 'Sample tracking', 'BAYI VE MUSTERI': 'Dealer & customer', 'KULLANICI DENEYIMI': 'User experience',
    'ROTA VE NAKLIYE': 'Route & transport', 'MALI TABLOLAR': 'Financial statements', 'HAM KAGIT': 'Raw paper',
    'CELIK BANT': 'Steel band', 'SAHA UYGULAMASI': 'Field application', 'SELF SERVIS': 'Self service',
    'PLATFORM ALIMI': 'Platform purchase', 'VERI TOPLAMA': 'Data collection', 'VERI SINIFLANDIRMA': 'Data classification',
    'YAZILIM ENTEGRASYONU': 'Software integration', 'YAZILIMDAN CIKIS': 'Software exit',
    // single words
    'DONANIM': 'Hardware', 'YAZILIM': 'Software', 'BAKIM': 'Maintenance', 'KIRALAMA': 'Rental',
    'DANISMANLIK': 'Consultancy', 'SISTEM': 'System', 'HABERLESME': 'Communication', 'SANTRAL': 'Switchboard',
    'KIRTASIYE': 'Stationery', 'GENEL': 'General', 'TASIMA': 'Transportation', 'YEMEKHANE': 'Canteen',
    'YEMEK': 'Meals', 'KONAKLAMA': 'Accommodation', 'OTEL': 'Hotel', 'SEYAHAT': 'Travel', 'UCRET': 'Wage',
    'SAGLIK': 'Health', 'ERZAK': 'Food supplies', 'BAYRAM': 'Holiday', 'EGITIM': 'Training', 'OGRENIM': 'Tuition',
    'YAKACAK': 'Heating allowance', 'INTERNET': 'Internet', 'VERGI': 'Tax', 'ARAC': 'Vehicle', 'OTOMASYON': 'Automation',
    'TERCUME': 'Translation', 'FOTOKOPI': 'Photocopy', 'MESAI': 'Working hours', 'PRIM': 'Premium',
    'URETIM': 'Production', 'FINANS': 'Finance', 'PAZARLAMA': 'Marketing', 'SATIS': 'Sales', 'SATINALMA': 'Purchasing',
    'RAPORLAMA': 'Reporting', 'PLANLAMA': 'Planning', 'MUSTERI': 'Customer', 'BAYI': 'Dealer', 'DEPO': 'Warehouse',
    'ODEME': 'Payment', 'BORDRO': 'Payroll', 'BUTCE': 'Budget', 'KALITE': 'Quality', 'KARLILIK': 'Profitability',
    'KARIYER': 'Career', 'PERSONEL': 'Personnel', 'OPERASYON': 'Operations', 'YENILEME': 'Renewal',
    'YETKILENDIRME': 'Authorization', 'DENETIM': 'Audit', 'ENERJI': 'Energy', 'SURECLER': 'Processes',
    'FATURA': 'Invoice', 'IRSALIYE': 'Delivery note', 'SOZLESME': 'Contract', 'SIPARIS': 'Order', 'STOK': 'Stock',
    'DOKUMAN': 'Document', 'KURULUM': 'Installation', 'IYILESTIRME': 'Improvement', 'ORGANIZASYON': 'Organization',
    'YONETIM': 'Management', 'DONUSUM': 'Transformation', 'IZLENEBILIRLIK': 'Traceability', 'LOJISTIK': 'Logistics',
    'KESIF': 'Discovery', 'KARSILIK': 'Provision', 'PERFORMANS': 'Performance', 'HAKEDIS': 'Progress payment',
    'DOLUM': 'Filling', 'FIRE': 'Scrap', 'TASERON': 'Subcontractor', 'MALEZYA': 'Malaysia', 'TAYLAND': 'Thailand',
    'TURKIYE': 'Turkey', 'MISIR': 'Egypt', 'RUSYA': 'Russia', 'IRAN': 'Iran', 'KATAR': 'Qatar', 'CEZAYIR': 'Algeria',
    'BULGARISTAN': 'Bulgaria', 'PROJE': 'Project', 'PROJESI': 'Project', 'GIDERLERI': 'Expenses', 'GIDERI': 'Expense',
    'GID.': 'Exp.', 'GID': 'Exp.', 'VE': '&', 'DIGER': 'Other', 'SERVIS': 'Service', 'ALIMLARI': 'purchases',
    'DEGISIMI': 'replacement', 'DEGISIMLERI': 'replacements', 'FABRIKA': 'Factory', 'SUNUCU': 'Server',
    'EKRANI': 'screen', 'SUNUM': 'Presentation', 'MONITOR': 'Monitor', 'YENILEMELERI': 'renewals',
    'ACIKLAMA': 'Explanation', 'DURUM': 'Status', 'MUDURLUK': 'Department', 'TANIMI': 'Description', 'TANIM': 'Description',
  };
  const WORD_KEYS = Object.keys(WORDS).sort((a, b) => b.length - a.length);
  const phraseKey = (s) => fold(s).toUpperCase().replace(/\s+/g, ' ').trim();
  const cache = {};

  // English for a Turkish string, or '' if nothing to translate (already English).
  function tr(s) {
    const raw = txt(s);
    if (!raw || /^[\d.,\s-]+$/.test(raw)) return '';
    if (cache[raw] !== undefined) return cache[raw];
    const key = phraseKey(raw);
    let outStr = '';
    if (PHRASES[key]) outStr = PHRASES[key];
    else {
      let rest = key, res = '', changed = false;
      while (rest.length) {
        let hit = null;
        for (const k of WORD_KEYS) {
          if (rest.startsWith(k)) {
            const next = rest.charAt(k.length);
            if (!next || /[\s\-/&,()]/.test(next) || /[.]$/.test(k)) { hit = k; break; }
          }
        }
        if (hit) { res += WORDS[hit]; rest = rest.slice(hit.length); changed = true; continue; }
        const m = rest.match(/^[^\s\-/&,()]+|^[\s\-/&,()]+/);
        res += m[0]; rest = rest.slice(m[0].length);
      }
      if (changed) outStr = res.replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim();
    }
    // Sentence-ish casing for readability.
    if (outStr && outStr === outStr.toUpperCase()) outStr = outStr.charAt(0) + outStr.slice(1).toLowerCase();
    if (outStr && phraseKey(outStr) === key) outStr = '';
    return (cache[raw] = outStr);
  }

  return { COUNTRIES, MONTHS, fold, norm, countryOf, parseRows, parseWorkbook, parseWithXLSX, parseFinanceRows, candidateSheets, summarize, tr, sum, r2 };
}));
