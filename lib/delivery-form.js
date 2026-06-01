/* Delivery-Acceptance form generator.
 *
 * Re-uses the company's real Excel template (templates/delivery-form/) so the
 * exported file keeps the exact layout, logo, borders and bilingual
 * commitments text. We only swap the placeholder cells in the worksheet for the
 * selected asset's values, then re-zip the package into a .xlsx.
 *
 * No third-party libraries: the .xlsx is just a ZIP, written here with the
 * STORE (no compression) method, which Excel opens fine.
 */
const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.join(__dirname, '..', 'templates', 'delivery-form');
const SHEET_PATH = 'xl/worksheets/sheet1.xml';

// ── Load the template files once (name → Buffer), keeping the package order. ──
function loadTemplate() {
  const files = [];
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, relPath);
      else files.push({ name: relPath, data: fs.readFileSync(full) });
    }
  })(TEMPLATE_DIR, '');
  // [Content_Types].xml should come first for maximum compatibility.
  files.sort((a, b) =>
    (a.name === '[Content_Types].xml' ? -1 : b.name === '[Content_Types].xml' ? 1 : 0));
  return files;
}

let TEMPLATE = null;
function template() { return (TEMPLATE = TEMPLATE || loadTemplate()); }

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Each placeholder cell in the template references a shared string. We replace
// the whole <c …><v>idx</v></c> with an inline-string cell holding the value,
// preserving the style (s="…") so borders/fonts stay intact.
// Cell refs come from the template's marked "" fields.
const CELLS = [
  { ref: 'C5',  s: '7',  vref: '17', key: 'brand_model' }, // Description of the inventory
  { ref: 'D5',  s: '27', vref: '18', key: 'asset_code'  }, // Inventory no
  { ref: 'E5',  s: '27', vref: '19', key: 'serial_no'   }, // S/N
  { ref: 'F5',  s: '25', vref: '20', key: 'date_print'  }, // Date print (turn-in date column)
  { ref: 'G16', s: '12', vref: '16', key: 'department'  }, // Receipt by — Location/Expense Center
  { ref: 'D17', s: '7',  vref: '14', key: 'it_member'   }, // Delivered by — IT member
  { ref: 'G17', s: '12', vref: '15', key: 'user_name'   }, // Receipt by — Full name (user)
];

function fillSheet(xml, values) {
  let out = xml;
  for (const c of CELLS) {
    const find = `<c r="${c.ref}" s="${c.s}" t="s"><v>${c.vref}</v></c>`;
    const val = xmlEscape(values[c.key] || '');
    const replace = `<c r="${c.ref}" s="${c.s}" t="inlineStr"><is><t xml:space="preserve">${val}</t></is></c>`;
    if (!out.includes(find)) {
      throw new Error(`Delivery-form template cell ${c.ref} not found — template changed?`);
    }
    out = out.replace(find, replace);
  }
  return out;
}

// ── Minimal ZIP writer (STORE method) ────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function buildZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);   // local file header signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(0, 8);            // method 0 = store
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0x21, 12);        // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);           // extra length
    nameBuf.copy(local, 30);
    locals.push(local, data);

    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);      // central dir signature
    cd.writeUInt16LE(20, 4);              // version made by
    cd.writeUInt16LE(20, 6);              // version needed
    cd.writeUInt16LE(0, 8);               // flags
    cd.writeUInt16LE(0, 10);              // method
    cd.writeUInt16LE(0, 12);              // mod time
    cd.writeUInt16LE(0x21, 14);           // mod date
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);              // extra length
    cd.writeUInt16LE(0, 32);              // comment length
    cd.writeUInt16LE(0, 34);              // disk number start
    cd.writeUInt16LE(0, 36);              // internal attrs
    cd.writeUInt32LE(0, 38);              // external attrs
    cd.writeUInt32LE(offset, 42);         // local header offset
    nameBuf.copy(cd, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/**
 * Build a filled-in Delivery-Acceptance .xlsx for one asset.
 * @param {object} values  brand_model, asset_code, serial_no, date_print,
 *                         department, it_member, user_name
 * @returns {Buffer}
 */
function buildDeliveryForm(values) {
  const files = template().map((f) => {
    if (f.name === SHEET_PATH) {
      return { name: f.name, data: Buffer.from(fillSheet(f.data.toString('utf8'), values), 'utf8') };
    }
    return f;
  });
  return buildZip(files);
}

module.exports = { buildDeliveryForm };
