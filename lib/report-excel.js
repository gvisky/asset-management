/* Excel report = a "Dashboard" sheet (title, key numbers, summary tables + native Excel charts)
   followed by the raw data sheets (styled header, filter, frozen header row).

   dashboard spec (built per report in routes/reports.js):
     { title, subtitle, kpis: [{ label, value, color }],
       tables: [{ title, headers: ['Status', 'Assets'], rows: [['Active', 500], …], chart: 'bar' | 'column' | 'doughnut' | 'none' }] }

   ExcelJS writes the styled workbook; it cannot make charts, so the chart parts (DrawingML) are added
   to the finished .xlsx file afterwards (JSZip). Charts read their numbers from the summary tables
   on the Dashboard sheet, so they stay editable in Excel. */

const ExcelJS = require('exceljs');
const JSZip = require('jszip');

const BRAND = '1A56DB';
const PALETTE = ['1A56DB', '16A34A', 'F59E0B', 'DC2626', '7C3AED', '0891B2', 'DB2777', '65A30D', 'EA580C', '475569', '0D9488', 'A16207'];
const KPI_COLORS = { blue: '1A56DB', green: '16A34A', amber: 'D97706', red: 'DC2626', purple: '7C3AED', grey: '475569', teal: '0891B2' };

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const sheetRef = (name) => `'${String(name).replace(/'/g, "''")}'`;

// ── Dashboard sheet ──────────────────────────────────────────────────────────
const TABLE_COL = 2;        // tables start in column B
const CHART_COL = 7;        // charts start in column G (0-based anchor col 6)
const CHART_COLS = 8;       // chart width in columns
const MIN_SECTION_ROWS = 13;

function buildDashboard(wb, d, meta) {
  const ws = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }], properties: { tabColor: { argb: 'FF' + BRAND } } });
  ws.columns = [{ width: 2 }, { width: 34 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 3 },
    ...Array.from({ length: CHART_COLS }, () => ({ width: 11 }))];
  const lastCol = CHART_COL + CHART_COLS - 1;

  // Title band
  ws.mergeCells(1, 2, 1, lastCol);
  const t = ws.getCell(1, 2);
  t.value = d.title;
  t.font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND } };
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 34;
  ws.mergeCells(2, 2, 2, lastCol);
  const m = ws.getCell(2, 2);
  m.value = [d.subtitle, `Generated ${meta.generated}`, meta.by && `by ${meta.by}`, meta.scope].filter(Boolean).join(' · ');
  m.font = { size: 10, color: { argb: 'FF64748B' } };
  m.alignment = { indent: 1 };

  // Key numbers: tiles of 2 columns, up to 6 per row (B-C, D-E, G-H, I-J, K-L, M-N)
  const slots = [[2, 3], [4, 5], [7, 8], [9, 10], [11, 12], [13, 14]];
  let row = 4;
  const kpis = d.kpis || [];
  for (let i = 0; i < kpis.length; i += slots.length) {
    kpis.slice(i, i + slots.length).forEach((k, j) => {
      const [c1, c2] = slots[j];
      const color = KPI_COLORS[k.color] || BRAND;
      ws.mergeCells(row, c1, row, c2); ws.mergeCells(row + 1, c1, row + 1, c2);
      const lab = ws.getCell(row, c1), val = ws.getCell(row + 1, c1);
      lab.value = k.label; val.value = k.value;
      lab.font = { size: 9, bold: true, color: { argb: 'FF64748B' } };
      val.font = { size: 20, bold: true, color: { argb: 'FF' + color } };
      for (const c of [lab, val]) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        c.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };
      }
      lab.border = { top: { style: 'medium', color: { argb: 'FF' + color } } };
      if (typeof k.value === 'number') val.numFmt = Number.isInteger(k.value) ? '#,##0' : '#,##0.0';
    });
    ws.getRow(row).height = 18; ws.getRow(row + 1).height = 30;
    row += 3;
  }

  // Summary tables, each with its chart on the right
  const charts = [];
  row += 1;
  for (const tb of d.tables || []) {
    const nVals = tb.headers.length - 1;
    ws.mergeCells(row, TABLE_COL, row, TABLE_COL + nVals);
    const st = ws.getCell(row, TABLE_COL);
    st.value = tb.title;
    st.font = { bold: true, size: 12, color: { argb: 'FF0F172A' } };
    st.border = { bottom: { style: 'thin', color: { argb: 'FF' + BRAND } } };
    const head = row + 1;
    tb.headers.forEach((h, j) => {
      const c = ws.getCell(head, TABLE_COL + j);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
      c.alignment = { horizontal: j ? 'right' : 'left', indent: j ? 0 : 1 };
    });
    const rows = tb.rows.length ? tb.rows : [['(no data)', ...Array(nVals).fill(0)]];
    rows.forEach((r, i) => {
      r.forEach((v, j) => {
        const c = ws.getCell(head + 1 + i, TABLE_COL + j);
        c.value = v;
        c.alignment = { horizontal: j ? 'right' : 'left', indent: j ? 0 : 1 };
        if (j && typeof v === 'number') c.numFmt = '#,##0';
        if (i % 2) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        c.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      });
    });
    const first = head + 1, last = head + rows.length;
    if (tb.total !== false && nVals === 1 && rows.length > 1 && tb.rows.length) {
      const tr = last + 1;
      ws.getCell(tr, TABLE_COL).value = 'Total';
      ws.getCell(tr, TABLE_COL + 1).value = { formula: `SUM(${colLetter(TABLE_COL + 1)}${first}:${colLetter(TABLE_COL + 1)}${last})`,
        result: rows.reduce((s, r) => s + (Number(r[1]) || 0), 0) };
      for (const j of [0, 1]) {
        const c = ws.getCell(tr, TABLE_COL + j);
        c.font = { bold: true }; c.alignment = { horizontal: j ? 'right' : 'left', indent: j ? 0 : 1 };
        c.border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } } };
        if (j) c.numFmt = '#,##0';
      }
    }
    const chartRows = Math.max(MIN_SECTION_ROWS, rows.length + 4);
    if (tb.chart && tb.chart !== 'none' && tb.rows.length) {
      charts.push({ type: tb.chart, title: tb.title, headers: tb.headers, rows, sheet: 'Dashboard',
        catCol: TABLE_COL, firstRow: first, lastRow: last,
        anchor: { col: CHART_COL - 1, row: row - 1, cols: CHART_COLS, rows: chartRows } });
    }
    row += Math.max(chartRows, rows.length + 4) + 2;
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return charts;
}

// ── Raw data sheets ──────────────────────────────────────────────────────────
function addDataSheet(wb, name, rows) {
  const ws = wb.addWorksheet(String(name).slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  const data = rows.length ? rows : [{ '(no data)': '' }];
  const headers = [...new Set(data.flatMap(r => Object.keys(r)))];
  ws.columns = headers.map(h => {
    let w = String(h).length;
    for (let i = 0; i < Math.min(data.length, 400); i++) w = Math.max(w, String(data[i][h] == null ? '' : data[i][h]).length);
    return { header: h, key: h, width: Math.min(Math.max(w + 2, 8), 50) };
  });
  for (const r of data) ws.addRow(headers.map(h => (r[h] == null ? '' : r[h])));
  const hr = ws.getRow(1);
  hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + BRAND } };
  hr.alignment = { vertical: 'middle' };
  hr.height = 20;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
}

// ── Native charts (DrawingML) ────────────────────────────────────────────────
function strCache(vals) {
  return `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
}
function numCache(vals) {
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v) || 0}</c:v></c:pt>`).join('')}</c:numCache>`;
}
const solid = (hex) => `<c:spPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></c:spPr>`;
const txPr = (sz, bold, color = '334155') => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;

function chartXml(ch) {
  const s = sheetRef(ch.sheet);
  const cat = `${s}!$${colLetter(ch.catCol)}$${ch.firstRow}:$${colLetter(ch.catCol)}$${ch.lastRow}`;
  const labels = ch.rows.map(r => r[0]);
  const nSeries = ch.headers.length - 1;
  const series = Array.from({ length: nSeries }, (_, k) => {
    const col = colLetter(ch.catCol + 1 + k);
    const name = `${s}!$${col}$${ch.firstRow - 1}`;
    const val = `${s}!$${col}$${ch.firstRow}:$${col}$${ch.lastRow}`;
    const vals = ch.rows.map(r => r[k + 1]);
    const dPts = ch.type === 'doughnut'
      ? labels.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/>${solid(PALETTE[i % PALETTE.length])}</c:dPt>`).join('') : '';
    const dLbls = ch.type === 'doughnut'
      ? `<c:dLbls><c:numFmt formatCode="0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900, true, 'FFFFFF')}<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>`
      : `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr>${txPr(900, true)}<c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`;
    return `<c:ser><c:idx val="${k}"/><c:order val="${k}"/><c:tx><c:strRef><c:f>${name}</c:f>${strCache([ch.headers[k + 1]])}</c:strRef></c:tx>
      ${ch.type === 'doughnut' ? '' : solid(PALETTE[k % PALETTE.length])}${ch.type === 'doughnut' ? '' : '<c:invertIfNegative val="0"/>'}${dPts}${dLbls}
      <c:cat><c:strRef><c:f>${cat}</c:f>${strCache(labels)}</c:strRef></c:cat>
      <c:val><c:numRef><c:f>${val}</c:f>${numCache(vals)}</c:numRef></c:val></c:ser>`;
  }).join('');

  let plot;
  if (ch.type === 'doughnut') {
    plot = `<c:doughnutChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
  } else {
    const dir = ch.type === 'column' ? 'col' : 'bar';
    // Horizontal bars: first row on top (category axis reversed); value axis hidden, numbers shown on the bars.
    plot = `<c:barChart><c:barDir val="${dir}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}
      <c:gapWidth val="60"/><c:axId val="5001"/><c:axId val="5002"/></c:barChart>
      <c:catAx><c:axId val="5001"/><c:scaling><c:orientation val="${dir === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/>
        <c:axPos val="${dir === 'bar' ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="CBD5E1"/></a:solidFill></a:ln></c:spPr>${txPr(900, false)}
        <c:crossAx val="5002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>
      <c:valAx><c:axId val="5002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="1"/>
        <c:axPos val="${dir === 'bar' ? 'b' : 'l'}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/>
        <c:tickLblPos val="nextTo"/><c:crossAx val="5001"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  }
  const legend = (ch.type === 'doughnut' || nSeries > 1)
    ? `<c:legend><c:legendPos val="${ch.type === 'doughnut' ? 'r' : 'b'}"/><c:overlay val="0"/>${txPr(900, false)}</c:legend>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<c:roundedCorners val="0"/>
<c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill></a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="0F172A"/></a:solidFill></a:rPr><a:t>${esc(ch.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>
<c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr>
<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>
</c:chartSpace>`;
}

function drawingXml(charts) {
  const anchors = charts.map((ch, i) => {
    const a = ch.anchor;
    return `<xdr:twoCellAnchor editAs="oneCell">
  <xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
  <xdr:to><xdr:col>${a.col + a.cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row + a.rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
  <xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
    <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
    <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic>
  </xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchors}
</xdr:wsDr>`;
}

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const REL_DRAWING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing';
const REL_CHART = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart';

async function addCharts(buf, charts) {
  if (!charts.length) return buf;
  const zip = await JSZip.loadAsync(buf);
  // The Dashboard is the first sheet → its file from the workbook relationships.
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const firstSheetRid = (wbXml.match(/<sheet [^>]*r:id="([^"]+)"/) || [])[1];
  const target = (wbRels.match(new RegExp(`<Relationship [^>]*Id="${firstSheetRid}"[^>]*>`)) || [''])[0].match(/Target="([^"]+)"/)[1];
  const sheetPath = 'xl/' + target.replace(/^\/?xl\//, '').replace(/^\//, '');
  const sheetFile = sheetPath.split('/').pop();
  const relsPath = `xl/worksheets/_rels/${sheetFile}.rels`;

  // Sheet → drawing relationship
  let rels = zip.file(relsPath) ? await zip.file(relsPath).async('string')
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}"></Relationships>`;
  const rid = 'rIdDash1';
  rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="${REL_DRAWING}" Target="../drawings/drawingDash1.xml"/></Relationships>`);
  zip.file(relsPath, rels);

  // <drawing r:id> goes after pageSetup / headerFooter …, before legacyDrawing / tableParts / extLst.
  let sx = await zip.file(sheetPath).async('string');
  if (!/xmlns:r=/.test(sx.slice(0, 600))) sx = sx.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  const tag = `<drawing r:id="${rid}"/>`;
  const before = sx.search(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/);
  sx = before >= 0 ? sx.slice(0, before) + tag + sx.slice(before) : sx.replace('</worksheet>', tag + '</worksheet>');
  zip.file(sheetPath, sx);

  zip.file('xl/drawings/drawingDash1.xml', drawingXml(charts));
  zip.file('xl/drawings/_rels/drawingDash1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL_NS}">${charts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL_CHART}" Target="../charts/chartDash${i + 1}.xml"/>`).join('')}</Relationships>`);
  charts.forEach((ch, i) => zip.file(`xl/charts/chartDash${i + 1}.xml`, chartXml(ch)));

  let ct = await zip.file('[Content_Types].xml').async('string');
  const overrides = [`<Override PartName="/xl/drawings/drawingDash1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    ...charts.map((_, i) => `<Override PartName="/xl/charts/chartDash${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)];
  ct = ct.replace('</Types>', overrides.join('') + '</Types>');
  zip.file('[Content_Types].xml', ct);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** → Buffer (.xlsx): Dashboard sheet + raw data sheets. */
async function buildExcelReport({ dashboard, sheets, meta }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hayat Communication Tools';
  wb.created = new Date();
  const charts = dashboard ? buildDashboard(wb, dashboard, meta) : [];
  for (const s of sheets) addDataSheet(wb, s.name, s.rows);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return addCharts(buf, charts);
}

module.exports = { buildExcelReport, PALETTE };
