/* Model catalogue helpers (Inventory → 📚 Models).

   Brand/Model is free text, so the same model is typed many ways ("LENOVO", "Lenovo T14 G2", "Xiaomi Monitor 23,8"-00316323-Name").
   cleanName() proposes one tidy name: brand spelled one way, serials / people / rooms after a dash dropped, "Gen5th" → "Gen 5".
   guessType() proposes an Asset Type from the words of the name. Both are only suggestions — IT confirms before anything changes. */

const BRANDS = {
  lenovo: 'Lenovo', dell: 'Dell', 'dell inc.': 'Dell', 'dell inc': 'Dell', hp: 'HP', samsung: 'Samsung', ss: 'Samsung',
  xiaomi: 'Xiaomi', sony: 'Sony', acer: 'Acer', asus: 'Asus', msi: 'MSI', apple: 'Apple', cisco: 'Cisco', logitech: 'Logitech',
  microsoft: 'Microsoft', ricoh: 'Ricoh', epson: 'Epson', zebra: 'Zebra', honeywell: 'Honeywell', lg: 'LG', canon: 'Canon',
  brother: 'Brother', huawei: 'Huawei', oppo: 'Oppo', fujifilm: 'Fujifilm', 'fuji xerox': 'Fuji Xerox',
};
// Model words that mean Lenovo even when the brand is not typed ("X1 yoga", "T490").
const LENOVO_MODEL = /^(thinkpad|ideapad|thinkcentre|thinkbook|yoga|x1|t4\d\d|t14s?|t15|e1[456]|l1[345]|m10|tb-)/i;
const CONTEXT_WORDS = /\b(room|team|director|office|factory|backup|qc|production|maintenance|reception|house|sale|sales|outbound|inbound|for|of|gm|vp|it|hr|mkt|warehouse|spare|old|new|less than|mil)\b/i;

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const serialLike = (t) => /^\d{5,}$/.test(t) || /\//.test(t) || (t.length >= 7 && /\d/.test(t) && /^[\w.#]+$/.test(t)) || /^[A-Z0-9]{8,}$/.test(t);
// Family names that start a person's name after a dash ("Monitor 27 - Nguyen Thi Lan").
const FAMILY = /^(nguyen|le|tran|pham|hoang|huynh|phan|vu|vo|dang|bui|do|ho|ngo|duong|ly|su|truong|dinh|lam|mai|cao|ta|thai|trinh|luu|doan)\b/i;
const hasNonAscii = (s) => /[^\x00-\x7F]/.test(s);

/** Tidy model name proposal. */
function cleanName(raw) {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/(\d),(\d)/g, '$1.$2');                       // 23,8" → 23.8"
  // Split on dashes, but keep model codes like "KD-55X700G" / "TB-X505L" (2–3 capital letters + dash, no spaces) together.
  const seg = s.split(/(\s*-\s*)/);
  const parts = [];
  for (let i = 0; i < seg.length; i += 2) {
    const p = seg[i].trim(); if (!p) continue;
    const prev = parts[parts.length - 1], sep = seg[i - 1];
    if (prev && sep === '-' && /\b[A-Z]{2,3}$/.test(prev) && !/\s/.test(p.split(/\s/)[0] || '')) parts[parts.length - 1] = prev + '-' + p.split(/\s+/)[0] + (p.includes(' ') ? ' ' + p.split(/\s+/).slice(1).join(' ') : '');
    else parts.push(p);
  }
  const keep = [parts[0]];
  for (const p of parts.slice(1)) {
    const ws = words(p);
    const drop = ws.some(serialLike) || CONTEXT_WORDS.test(p) || hasNonAscii(p) || FAMILY.test(p) || (/^[A-Z][a-z]+( [A-Z][a-z.]*){1,4}$/.test(p) && ws.length >= 2);
    if (!drop) keep.push(p);
  }
  let out = keep.join(' ');
  out = out.replace(/\b(monitor|tv)(\d)/ig, '$1 $2').replace(/\s*(inches|inch)\b/ig, '"').replace(/(\d)\s+"/g, '$1"');
  // Words typed in capitals ("IP PHONE CISCO") → Title case; short codes (IP, TV, UPS, KVA) stay.
  out = words(out).map(w => (/^[A-Z]{4,}$/.test(w) && !BRANDS[w.toLowerCase()]) ? w[0] + w.slice(1).toLowerCase() : w).join(' ');
  // Brand: one spelling, first.
  out = out.replace(/^dell inc\.?/i, 'Dell').replace(/^ss\b/i, 'Samsung');
  out = words(out).map((w, i) => { const b = BRANDS[w.toLowerCase()]; return b && (i === 0 || BRANDS[w.toLowerCase()] === w || w === w.toUpperCase() || w === w.toLowerCase()) ? b : w; }).join(' ');
  out = out.replace(/\bgen\s*(\d{1,2})(st|nd|rd|th)?\b/ig, 'Gen $1');
  if (/^lenovo\b/i.test(out) || LENOVO_MODEL.test(out)) out = out.replace(/\b(T14s?|T15|E1[456]|L1[345]|X1 \w+) G(\d)\b/g, '$1 Gen $2');
  out = out.replace(/^(laptop|notebook|desktop)\s+(?=(lenovo|dell|hp|acer|asus|msi|apple)\b)/i, '');
  if (LENOVO_MODEL.test(out) && !/^lenovo\b/i.test(out)) out = 'Lenovo ' + out;
  out = out.replace(/\b(yoga|carbon|ideapad|thinkpad)\b/ig, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase())
    .replace(/\bideapad\s*(\d)/i, 'IdeaPad $1').replace(/\bIdeapad\b/, 'IdeaPad').replace(/\bThinkpad\b/, 'ThinkPad')
    .replace(/\biphone\b/i, 'iPhone').replace(/\bipad\b/i, 'iPad');
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > 80 ? out.slice(0, 80).trim() : out;
}

/** Comparison key: same key = same model. */
const keyOf = (s) => words(String(s || '').toLowerCase().replace(/[^a-z0-9."]+/g, ' ')).sort().join(' ');

/** A name that is only a brand (or "Desktop lenovo") — the model is unknown. */
function isVague(name) {
  const ws = words(String(name).replace(/[.,]/g, ' ').toLowerCase()).filter(w => !['inc', 'computer', 'desktop', 'laptop', 'notebook', 'pc'].includes(w));
  return ws.length === 0 || (ws.length === 1 && !!BRANDS[ws[0]]);
}

const TYPE_RULES = [
  ['IP phone', /\bip ?phone\b/i],
  ['Hand terminals', /hand ?terminal/i],
  ['Mobile phone', /\b(iphone|galaxy|redmi|cell ?fone|cell ?phone|mobile phone|smartphone|oppo|reno)\b/i],
  ['Tablet', /\b(tablet|surface|ipad|m10|tb-x|tab \w)/i],
  ['Printer', /\b(printer|photocopy|apeosport|laserjet|ricoh|epson|zt4\d|label printer|scanner)\b/i],
  ['Screen', /\b(monitor|screen|tv|tivi|display)\b/i],
  ['Desktop', /\b(desktop|thinkcentre|optiplex|mini ?pc|msi b\d|all.in.one|imac)\b/i],
  ['Laptop', /\b(laptop|notebook|thinkpad|ideapad|thinkbook|latitude|elitebook|probook|vostro|macbook|yoga|carbon|x1|t4\d\d|t14s?|t15|e1[456]|840 g\d|zenbook|vivobook)(?![a-z])/i],
  ['Camera', /\b(camera|cam|webcam)\b/i],
  ['License', /\b(software|license|licence|subscription|autocad|solid ?works?)\b/i],
];
function guessType(name) {
  const both = `${name} ${cleanName(name)}`;
  for (const [t, re] of TYPE_RULES) if (re.test(both)) return t;
  if (/^(lenovo|dell|hp|acer|asus)$/i.test(cleanName(name))) return 'Laptop';
  return '';
}

module.exports = { cleanName, keyOf, isVague, guessType, BRANDS };
