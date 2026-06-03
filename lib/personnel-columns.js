// Shared column definition for the User Inventory report (export) and its
// re-upload importer, so the two never drift apart. Mirrors lib/asset-columns.js.
//  - header   : column title in the spreadsheet
//  - field    : personnel table column
//  - writable : true → applied on re-upload; false → ID is the match key only
const PERSONNEL_COLUMNS = [
  { header: 'ID',           field: 'id',           writable: false },
  { header: 'Display Name', field: 'display_name', writable: true  },
  { header: 'Email',        field: 'email',        writable: true  },
  { header: 'Country',      field: 'country',      writable: true  },
  { header: 'Department',   field: 'department',   writable: true  },
  { header: 'Cost Center',  field: 'cost_center',  writable: true  },
  { header: 'User Type',    field: 'user_type',    writable: true  },
  { header: 'Status',       field: 'status',       writable: true  },
  { header: 'Leaving Date', field: 'leaving_date', writable: true  },
  { header: 'Company Name', field: 'company_name', writable: true  },
  { header: 'Position',     field: 'position',     writable: true  },
];

module.exports = { PERSONNEL_COLUMNS };
