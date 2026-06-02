// Shared column definition for the Asset Inventory report (export) and its
// re-upload importer, so the two never drift apart.
//
// Order = column order in the .xlsx.
//  - header   : the exact column title written/expected in the spreadsheet
//  - field    : the assets table column it maps to
//  - writable : true  → applied on re-upload
//               false → exported for reference only, never overwritten on import
//                       (ID is the match key; History/Locked are preserved as-is)
const ASSET_COLUMNS = [
  { header: 'ID',                      field: 'id',               writable: false },
  { header: 'Asset S4',                field: 'asset_s4',         writable: true  },
  { header: 'Asset Code (ECC)',        field: 'asset_code',       writable: true  },
  { header: 'Cost Center',             field: 'cost_center',      writable: true  },
  { header: 'Cost Center Description', field: 'cost_center_desc', writable: true  },
  { header: 'ECC CC',                  field: 'ecc_cc',           writable: true  },
  { header: 'Asset Description',       field: 'asset_description',writable: true  },
  { header: 'Asset Type',              field: 'asset_type',       writable: true  },
  { header: 'Brand/Model',             field: 'brand_model',      writable: true  },
  { header: 'Computer No',             field: 'computer_no',      writable: true  },
  { header: 'Serial',                  field: 'serial_no',        writable: true  },
  { header: 'M&K',                     field: 'mk',               writable: true  },
  { header: 'Country',                 field: 'country',          writable: true  },
  { header: 'Location',                field: 'location',         writable: true  },
  { header: 'Department',              field: 'department',       writable: true  },
  { header: 'Status',                  field: 'status',           writable: true  },
  { header: 'User Name',               field: 'user_name',        writable: true  },
  { header: 'AD Name',                 field: 'ad_name',          writable: true  },
  { header: 'Date Assigned',           field: 'date_assigned',    writable: true  },
  { header: 'Purchase Date',           field: 'purchase_date',    writable: true  },
  { header: 'Warranty Expiry',         field: 'warranty_expiry',  writable: true  },
  { header: 'Vendor',                  field: 'vendor',           writable: true  },
  { header: 'Cost',                    field: 'cost',             writable: true  },
  { header: 'PO Number',               field: 'po_number',        writable: true  },
  { header: 'Remark',                  field: 'remark',           writable: true  },
  { header: 'History Usage',           field: 'history_usage',    writable: false },
  { header: 'Locked',                  field: 'fields_locked',    writable: false },
];

// Canonical Asset Type labels (collapses case variants like "screen"/"Screen",
// "ip phone"/"IP phone"). Unknown values are kept as typed (just trimmed).
const ASSET_TYPE_CANON = {
  'laptop': 'Laptop', 'screen': 'Screen', 'monitor': 'Screen', 'ip phone': 'IP phone',
  'hand terminals': 'Hand terminals', 'hand terminal': 'Hand terminals', 'tablet': 'Tablet',
  'printer': 'Printer', 'mobile phone': 'Mobile phone', 'desktop': 'Desktop', 'license': 'License',
  'live stream': 'Live Stream', 'data center': 'Data Center', 'camera': 'Camera',
};
function normalizeAssetType(v) {
  const t = String(v == null ? '' : v).trim();
  if (!t) return '';
  return ASSET_TYPE_CANON[t.toLowerCase()] || t;
}

module.exports = { ASSET_COLUMNS, normalizeAssetType };
