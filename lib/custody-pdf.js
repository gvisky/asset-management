/* Handover / return record (PDF) with the person's e-signature.
   Kept on the asset (asset_docs) instead of a paper custody form. A simple electronic signature
   (drawn signature + login of the IT member + time + IP + SHA-256 of the record) — fine for an internal
   custody record; Vietnam's Law on E-Transactions 2023 does not deny a signature validity only for
   being electronic. */

const PDFDocument = require('pdfkit');
const path = require('path');

const FONT = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const FONT_B = path.join(__dirname, '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

const TERMS = {
  handover: [
    'I have received the equipment above in the condition described, with its accessories.',
    'I will use it for company work, keep it safe, and not lend, sell or modify it.',
    'I will report loss, theft or damage to IT immediately.',
    'I will return it, with all accessories and company data, when IT asks or when I leave the company.',
  ],
  return: [
    'I have returned the equipment above, with the accessories and in the condition described.',
    'I have not kept company data on personal devices; IT may wipe the device.',
  ],
};
const TERMS_VI = {
  handover: 'Tôi đã nhận thiết bị trên, cam kết sử dụng cho công việc, bảo quản cẩn thận, báo ngay cho IT khi mất / hỏng và hoàn trả khi IT yêu cầu hoặc khi nghỉ việc.',
  return: 'Tôi đã hoàn trả thiết bị trên cùng phụ kiện, đúng tình trạng như mô tả.',
};

/** → Promise<Buffer> */
function buildCustodyPdf({ kind, asset, person, note, signaturePng, by, when, ip, recordId }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `${kind === 'return' ? 'Return' : 'Handover'} record ${asset.asset_s4 || asset.asset_code || '#' + asset.id}` } });
    const chunks = [];
    doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    doc.registerFont('R', FONT); doc.registerFont('B', FONT_B);
    const W = doc.page.width - 96, L = 48;
    const isRet = kind === 'return';

    doc.rect(L, 40, W, 46).fill(isRet ? '#0f766e' : '#1a56db');
    doc.font('B').fontSize(16).fillColor('#fff').text(isRet ? 'IT Equipment Return Record' : 'IT Equipment Handover Record', L + 14, 50, { width: W - 28 });
    doc.font('R').fontSize(9).fillColor('#e0e7ff').text(isRet ? 'Biên bản hoàn trả thiết bị CNTT' : 'Biên bản bàn giao thiết bị CNTT', L + 14, 70);
    doc.fillColor('#0f172a');
    let y = 104;
    const row = (label, value) => {
      doc.font('R').fontSize(9).fillColor('#64748b').text(label, L, y, { width: 140 });
      doc.font('B').fontSize(10).fillColor('#0f172a').text(String(value || '—'), L + 145, y, { width: W - 145 });
      y = Math.max(doc.y, y + 14) + 4;
    };
    const section = (t) => { y += 6; doc.font('B').fontSize(11).fillColor('#1a56db').text(t, L, y); y = doc.y + 4;
      doc.moveTo(L, y).lineTo(L + W, y).lineWidth(0.6).strokeColor('#cbd5e1').stroke(); y += 6; };

    section('Equipment / Thiết bị');
    row('Asset code (S4 / ECC)', [asset.asset_s4, asset.asset_code].filter(Boolean).join(' / '));
    row('Type · Brand / model', [asset.asset_type, asset.brand_model].filter(Boolean).join(' · '));
    row('Serial', asset.serial_no);
    row('Computer No', asset.computer_no);
    row('Country · site', [asset.country, asset.location].filter(Boolean).join(' · '));
    row(isRet ? 'Condition on return' : 'Condition / accessories', note);

    section(isRet ? 'Returned by / Người hoàn trả' : 'Received by / Người nhận');
    row('Name', person.name);
    row('Email', person.email);
    row('Department', person.department);

    section(isRet ? 'Received back by IT / IT nhận lại' : 'Handed over by IT / IT bàn giao');
    row('IT member', by);
    row('Date and time', when);

    section('Declaration / Cam kết');
    doc.font('R').fontSize(9.5).fillColor('#0f172a');
    for (const t of TERMS[isRet ? 'return' : 'handover']) { doc.text('•  ' + t, L, y, { width: W }); y = doc.y + 3; }
    doc.font('R').fontSize(9).fillColor('#475569').text(TERMS_VI[isRet ? 'return' : 'handover'], L, y + 2, { width: W }); y = doc.y + 10;

    section('Signature / Chữ ký');
    if (signaturePng) {
      try { doc.image(signaturePng, L, y, { fit: [260, 110] }); } catch { /* bad image → leave blank */ }
    }
    doc.moveTo(L, y + 116).lineTo(L + 260, y + 116).lineWidth(0.6).strokeColor('#94a3b8').stroke();
    doc.font('R').fontSize(9).fillColor('#64748b').text(person.name || '', L, y + 120);
    y += 146;

    doc.font('R').fontSize(7.5).fillColor('#94a3b8')
      .text(`Signed electronically in Hayat Communication Tools · record #${recordId} · ${when} · IP ${ip || '—'} · entered by ${by}. ` +
        'The SHA-256 fingerprint of this record is kept with the asset; any change to the file can be detected.', L, Math.min(y, doc.page.height - 90), { width: W });
    doc.end();
  });
}

module.exports = { buildCustodyPdf };
