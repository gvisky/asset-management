/**
 * Import script: reads Asset_List_Organized.xlsx from the parent folder
 * and populates the SQLite database.
 * Run once: node db/import.js
 */

const XLSX = require('xlsx');
const path = require('path');
const { get, run } = require('./database');

const EXCEL_PATH = path.join(__dirname, '../../Asset_List_Organized.xlsx');

function excelDateToString(value) {
  if (!value) return '';
  if (typeof value === 'number') {
    // Excel serial date → JS Date
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }
  return String(value).trim();
}

function cleanStr(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

async function importSheet(wb, sheetName, locationLabel, dateColIndex) {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.warn(`Sheet "${sheetName}" not found — skipping.`);
    return 0;
  }

  // Read starting from row 4 (header is row 3, data from row 4)
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  // Find the header row (row index where "No." appears in col A)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (String(rows[i][0]).trim() === 'No.') { headerIdx = i; break; }
  }
  if (headerIdx === -1) { console.warn(`No header found in sheet ${sheetName}`); return 0; }

  const INSERT_SQL = `
    INSERT INTO assets
      (location, department, computer_no, brand_model, date_assigned,
       serial_no, mk, asset_code, user_name, ad_name, history_usage, remark, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  let count = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    // Skip completely empty rows
    if (row.every(cell => cleanStr(cell) === '')) continue;

    let asset;

    if (locationLabel === 'Factory') {
      // Cols: A=No, B=Location, C=Department, D=ComputerNo, E=Brand/Model,
      //        F=DateAssigned, G=Serial, H=M&K, I=AssetCode, J=UserName, K=ADName,
      //        L=HistoryUsage, M=Remark
      asset = {
        location:      'Factory',
        department:    cleanStr(row[2]),
        computer_no:   cleanStr(row[3]),
        brand_model:   cleanStr(row[4]),
        date_assigned: excelDateToString(row[5]),
        serial_no:     cleanStr(row[6]),
        mk:            cleanStr(row[7]),
        asset_code:    cleanStr(row[8]),
        user_name:     cleanStr(row[9]),
        ad_name:       cleanStr(row[10]),
        history_usage: cleanStr(row[11]),
        remark:        cleanStr(row[12]),
        status:        'Active',
      };
    } else {
      // Office cols: A=No, B=Location, C=Department, D=ComputerNo, E=Brand/Model,
      //              F=UserName, G=Serial, H=M&K, I=AssetCode, J=ADName,
      //              K=HistoryUsage, L=Remark
      asset = {
        location:      'Office',
        department:    cleanStr(row[2]),
        computer_no:   cleanStr(row[3]),
        brand_model:   cleanStr(row[4]),
        date_assigned: '',
        serial_no:     cleanStr(row[6]),
        mk:            cleanStr(row[7]),
        asset_code:    cleanStr(row[8]),
        user_name:     cleanStr(row[5]),
        ad_name:       cleanStr(row[9]),
        history_usage: cleanStr(row[10]),
        remark:        cleanStr(row[11]),
        status:        'Active',
      };
    }

    await run(INSERT_SQL, [
      asset.location, asset.department, asset.computer_no, asset.brand_model,
      asset.date_assigned, asset.serial_no, asset.mk, asset.asset_code,
      asset.user_name, asset.ad_name, asset.history_usage, asset.remark, asset.status
    ]);
    count++;
  }
  return count;
}

async function main() {
  // Check if already imported
  const existing = await get('SELECT COUNT(*) as cnt FROM assets');
  if (Number(existing.cnt) > 0) {
    console.log(`Database already has ${existing.cnt} assets. To re-import, delete db/assets.db first.`);
    return;
  }

  let wb;
  try {
    wb = XLSX.readFile(EXCEL_PATH);
  } catch (e) {
    console.error('Could not read Excel file:', EXCEL_PATH);
    console.error(e.message);
    process.exit(1);
  }

  console.log('Importing Factory assets...');
  const factorySheet = wb.SheetNames.find(n => n.includes('Factory'));
  const officeSheet  = wb.SheetNames.find(n => n.includes('Office'));

  const factoryCount = await importSheet(wb, factorySheet, 'Factory', 5);
  const officeCount  = await importSheet(wb, officeSheet,  'Office',  null);

  console.log(`Imported: ${factoryCount} Factory + ${officeCount} Office = ${factoryCount + officeCount} total assets.`);
}

main();
