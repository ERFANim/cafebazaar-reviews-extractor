function cbrEnsureAppsSheet() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName(CBR_CONFIG.APPS_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CBR_CONFIG.APPS_SHEET_NAME);
    sheet.getRange(1, 1, 1, CBR_CONFIG.APPS_HEADERS.length).setValues([CBR_CONFIG.APPS_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, CBR_CONFIG.APPS_HEADERS.length);
    return sheet;
  }
  var lastColumn = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow === 0 && lastColumn === 0) {
    sheet.getRange(1, 1, 1, CBR_CONFIG.APPS_HEADERS.length).setValues([CBR_CONFIG.APPS_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  var oldLength = CBR_CONFIG.APPS_HEADERS.length - 1;
  if ((lastColumn !== oldLength && lastColumn !== CBR_CONFIG.APPS_HEADERS.length) || lastRow < 1) {
    throw new Error('The Apps sheet exists but does not contain the expected schema.');
  }
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (headers.join('\u001f') !== CBR_CONFIG.APPS_HEADERS.slice(0, lastColumn).join('\u001f')) {
    throw new Error('The Apps sheet exists but appears unrelated or corrupted. Expected headers were not found.');
  }
  if (lastColumn === oldLength) {
    sheet.getRange(1, CBR_CONFIG.APPS_HEADERS.length).setValue('history_anchor_cursor');
  }
  return sheet;
}

function cbrAppFromRow(values, rowNumber) {
  var app = { _row: rowNumber };
  for (var i = 0; i < CBR_CONFIG.APPS_HEADERS.length; i++) app[CBR_CONFIG.APPS_HEADERS[i]] = cbrString(values[i]);
  app.sheet_id = Number(values[2]);
  app.import_from_date = cbrNormalizeDate(values[4]);
  app.imported_until_date = values[5] == null || values[5] === '' ? '' : cbrNormalizeDate(values[5]);
  return app;
}

function cbrListApps() {
  var sheet = cbrEnsureAppsSheet();
  var count = sheet.getLastRow() - 1;
  if (count <= 0) return [];
  var rows = sheet.getRange(2, 1, count, CBR_CONFIG.APPS_HEADERS.length).getValues();
  return rows.filter(function(row) { return cbrString(row[0]).trim() !== ''; })
    .map(function(row, index) { return cbrAppFromRow(row, index + 2); });
}

function cbrFindApp(packageName) {
  var target = String(packageName).trim();
  var apps = cbrListApps();
  for (var i = 0; i < apps.length; i++) if (apps[i].package_name === target) return apps[i];
  return null;
}

function cbrInsertApp(app) {
  if (cbrFindApp(app.package_name)) throw new Error('An app with this package name already exists.');
  var sheet = cbrEnsureAppsSheet();
  var row = CBR_CONFIG.APPS_HEADERS.map(function(header) { return app[header] == null ? '' : app[header]; });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return cbrFindApp(app.package_name);
}

function cbrUpdateApp(packageName, changes) {
  var app = cbrFindApp(packageName);
  if (!app) throw new Error('Configured app was not found: ' + packageName);
  var sheet = cbrEnsureAppsSheet();
  Object.keys(changes).forEach(function(key) {
    var column = CBR_CONFIG.APPS_HEADERS.indexOf(key);
    if (column < 0) throw new Error('Unknown Apps metadata field: ' + key);
    sheet.getRange(app._row, column + 1).setValue(changes[key] == null ? '' : changes[key]);
  });
  if (!Object.prototype.hasOwnProperty.call(changes, 'updated_at')) {
    sheet.getRange(app._row, CBR_CONFIG.APPS_HEADERS.indexOf('updated_at') + 1).setValue(cbrNowIso());
  }
  return cbrFindApp(packageName);
}

function cbrResolveAppSheet(app) {
  var sheets = SpreadsheetApp.getActive().getSheets();
  var resolved = cbrFindSheetById(sheets, app.sheet_id);
  if (resolved) {
    if (resolved.getName() !== app.sheet_name) cbrUpdateApp(app.package_name, { sheet_name: resolved.getName() });
    return resolved;
  }
  throw new Error('Review sheet is missing for ' + app.app_name + ' (sheet ID ' + app.sheet_id + ').');
}

function cbrFindSheetById(sheets, sheetId) {
  var wantedId = Number(sheetId);
  for (var i = 0; i < sheets.length; i++) {
    if (Number(sheets[i].getSheetId()) === wantedId) return sheets[i];
  }
  return null;
}

if (typeof module !== 'undefined') module.exports = {
  appFromRow: cbrAppFromRow,
  findSheetById: cbrFindSheetById
};
