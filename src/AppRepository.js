function cbrEnsureAppsSheet() {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName(CBR_CONFIG.APPS_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(CBR_CONFIG.APPS_SHEET_NAME);
    cbrEnsureAppsColumnCapacity(sheet);
    sheet.getRange(1, 1, 1, CBR_CONFIG.APPS_HEADERS.length).setValues([CBR_CONFIG.APPS_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, CBR_CONFIG.APPS_HEADERS.length);
    cbrPrepareAppsSheet(sheet);
    return sheet;
  }
  var lastColumn = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();
  if (lastRow === 0 && lastColumn === 0) {
    cbrEnsureAppsColumnCapacity(sheet);
    sheet.getRange(1, 1, 1, CBR_CONFIG.APPS_HEADERS.length).setValues([CBR_CONFIG.APPS_HEADERS]);
    cbrPrepareAppsSheet(sheet);
    return sheet;
  }
  if (lastColumn < 13 || lastColumn > CBR_CONFIG.APPS_HEADERS.length || lastRow < 1) {
    throw new Error('The Apps sheet exists but does not contain the expected schema.');
  }
  var headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  if (headers.join('\u001f') !== CBR_CONFIG.APPS_HEADERS.slice(0, lastColumn).join('\u001f')) {
    throw new Error('The Apps sheet exists but appears unrelated or corrupted. Expected headers were not found.');
  }
  if (lastColumn < CBR_CONFIG.APPS_HEADERS.length) {
    cbrEnsureAppsColumnCapacity(sheet);
    var missing = CBR_CONFIG.APPS_HEADERS.slice(lastColumn);
    sheet.getRange(1, lastColumn + 1, 1, missing.length).setValues([missing]);
    cbrBackfillSourceMetadata(sheet);
    cbrPrepareAppsSheet(sheet);
  }
  return sheet;
}

function cbrEnsureAppsColumnCapacity(sheet) {
  var missing = CBR_CONFIG.APPS_HEADERS.length - sheet.getMaxColumns();
  if (missing > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), missing);
}

function cbrPrepareAppsSheet(sheet) {
  var note = 'Internal CafeBazaar Reviews application state. Do not edit this sheet manually; use the Sidebar.';
  var description = 'CafeBazaar Reviews internal Apps state';
  sheet.setFrozenRows(1);
  var header = sheet.getRange(1, 1);
  if (header.getNote() !== note) header.setNote(note);
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  var protection = null;
  for (var i = 0; i < protections.length; i++) {
    if (protections[i].getDescription() === description) protection = protections[i];
  }
  if (!protection) protection = sheet.protect().setDescription(description);
  if (!protection.isWarningOnly()) protection.setWarningOnly(true);
  if (!sheet.isSheetHidden()) {
    var sheets = SpreadsheetApp.getActive().getSheets();
    for (var j = 0; j < sheets.length; j++) {
      if (sheets[j].getSheetId() !== sheet.getSheetId() && !sheets[j].isSheetHidden()) {
        sheet.hideSheet();
        break;
      }
    }
  }
}

function cbrStoreValue(value) {
  var store = cbrString(value).trim() || CBR_CONFIG.STORE.CAFEBAZAAR;
  if (!/^[a-z][a-z0-9_]*$/.test(store)) throw new Error('Invalid Apps store value: ' + store);
  return store;
}

function cbrBackfillSourceMetadata(sheet, rows) {
  if (!rows) {
    var count = sheet.getLastRow() - 1;
    if (count <= 0) return;
    rows = sheet.getRange(2, 1, count, CBR_CONFIG.APPS_HEADERS.length).getValues();
  }
  for (var i = 0; i < rows.length; i++) {
    var packageName = cbrString(rows[i][0]).trim();
    if (!packageName) continue;
    var store = cbrStoreValue(rows[i][16]);
    var sourceUrl = cbrString(rows[i][17]);
    if (store === CBR_CONFIG.STORE.CAFEBAZAAR) sourceUrl = cbrCafeBazaarSourceUrl(packageName);
    if (rows[i][16] !== store || rows[i][17] !== sourceUrl) {
      sheet.getRange(i + 2, 17, 1, 2).setValues([[store, sourceUrl]]);
      rows[i][16] = store;
      rows[i][17] = sourceUrl;
    }
  }
}

function cbrBackfillCoverage() {
  var sheet = cbrEnsureAppsSheet();
  cbrPrepareAppsSheet(sheet);
  var count = sheet.getLastRow() - 1;
  if (count <= 0) return;
  var rows = sheet.getRange(2, 1, count, CBR_CONFIG.APPS_HEADERS.length).getValues();
  cbrBackfillSourceMetadata(sheet, rows);
  var sheets = SpreadsheetApp.getActive().getSheets();
  for (var i = 0; i < rows.length; i++) {
    if (!cbrString(rows[i][0]).trim()) continue;
    var reviewSheet = cbrFindSheetById(sheets, rows[i][2]);
    if (!reviewSheet) continue;
    if (reviewSheet.getLastRow() < 2) {
      if (rows[i][14] || rows[i][15]) sheet.getRange(i + 2, 15, 1, 2).setValues([['', '']]);
      continue;
    }
    if (rows[i][14] && rows[i][15]) continue;
    var range = cbrGetImportedDateRange(reviewSheet);
    sheet.getRange(i + 2, 15, 1, 2).setValues([[range.oldest, range.newest]]);
  }
}

function cbrAppFromRow(values, rowNumber) {
  var app = { _row: rowNumber };
  for (var i = 0; i < CBR_CONFIG.APPS_HEADERS.length; i++) app[CBR_CONFIG.APPS_HEADERS[i]] = cbrString(values[i]);
  app.sheet_id = Number(values[2]);
  app.import_from_date = cbrNormalizeDate(values[4]);
  app.imported_until_date = values[5] == null || values[5] === '' ? '' : cbrNormalizeDate(values[5]);
  app.coverage_from_date = values[14] == null || values[14] === '' ? '' : cbrNormalizeDate(values[14]);
  app.coverage_to_date = values[15] == null || values[15] === '' ? '' : cbrNormalizeDate(values[15]);
  app.store = cbrStoreValue(values[16]);
  return app;
}

function cbrListApps() {
  var sheet = cbrEnsureAppsSheet();
  var count = sheet.getLastRow() - 1;
  if (count <= 0) return [];
  var rows = sheet.getRange(2, 1, count, CBR_CONFIG.APPS_HEADERS.length).getValues();
  cbrBackfillSourceMetadata(sheet, rows);
  var apps = [];
  for (var i = 0; i < rows.length; i++) {
    if (cbrString(rows[i][0]).trim()) apps.push(cbrAppFromRow(rows[i], i + 2));
  }
  return apps;
}

function cbrFindApp(packageName, store) {
  var target = String(packageName).trim();
  var targetStore = cbrStoreValue(store);
  var apps = cbrListApps();
  for (var i = 0; i < apps.length; i++) {
    if (apps[i].package_name === target && apps[i].store === targetStore) return apps[i];
  }
  return null;
}

function cbrInsertApp(app) {
  var store = cbrStoreValue(app.store);
  if (cbrFindApp(app.package_name, store)) throw new Error('An app with this package name already exists in this store.');
  app.store = store;
  if (store === CBR_CONFIG.STORE.CAFEBAZAAR) app.source_url = cbrCafeBazaarSourceUrl(app.package_name);
  var sheet = cbrEnsureAppsSheet();
  var row = CBR_CONFIG.APPS_HEADERS.map(function(header) { return app[header] == null ? '' : app[header]; });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
  return cbrFindApp(app.package_name, store);
}

function cbrUpdateApp(packageName, changes, store) {
  var app = cbrFindApp(packageName, store);
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
  return cbrFindApp(packageName, store);
}

function cbrResolveAppSheet(app) {
  var sheets = SpreadsheetApp.getActive().getSheets();
  var resolved = cbrFindSheetById(sheets, app.sheet_id);
  if (resolved) {
    if (resolved.getName() !== app.sheet_name) cbrUpdateApp(app.package_name, { sheet_name: resolved.getName() }, app.store);
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
