function onOpen() {
  SpreadsheetApp.getUi().createMenu('CafeBazaar Reviews').addItem('Open Panel', 'showSidebar').addToUi();
}

function showSidebar() {
  cbrEnsureReadmeSheet();
  var html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('CafeBazaar Reviews');
  SpreadsheetApp.getUi().showSidebar(html);
}

function cbrFormatLastSyncForUi(value, timeZone) {
  if (!value) return '—';
  var syncedAt = new Date(value);
  if (isNaN(syncedAt.getTime())) return '—';
  return Utilities.formatDate(syncedAt, timeZone, 'yyyy-MM-dd HH:mm');
}

function uiGetApps() {
  return cbrWithDocumentLock(function() {
    cbrBackfillCoverage();
    var spreadsheet = SpreadsheetApp.getActive();
    var sheets = spreadsheet.getSheets();
    var timeZone = spreadsheet.getSpreadsheetTimeZone();
    return cbrListApps().map(function(app) {
      return {
        package_name: app.package_name, app_name: app.app_name, store: app.store,
        store_label: cbrStoreDisplayName(app.store), sheet_id: app.sheet_id,
        sheet_name: app.sheet_name, import_from_date: app.import_from_date,
        imported_until_date: app.imported_until_date, operation_type: app.operation_type,
        status: app.status, last_sync_at: app.last_sync_at, last_error: app.last_error,
        last_sync_display: cbrFormatLastSyncForUi(app.last_sync_at, timeZone),
        coverage_from_date: app.coverage_from_date, coverage_to_date: app.coverage_to_date,
        review_sheet_missing: !cbrFindSheetById(sheets, app.sheet_id)
      };
    });
  });
}

function uiAddApp(payload) {
  return cbrWithDocumentLock(function() {
    var appName = String(payload && payload.appName || '').trim();
    var source = cbrNormalizeAppSource(payload && payload.packageName);
    cbrGetReviewProvider(source.store);
    var packageName = source.packageName;
    var importFromDate = cbrNormalizeDate(payload && payload.importFromDate);
    if (!appName) throw new Error('App Name is required.');
    var existing = cbrFindApp(packageName, source.store);
    if (existing) {
      if (importFromDate < existing.import_from_date) return cbrExtendHistory(existing, importFromDate);
      return { message: 'This package is already configured. No new app or sheet was created. Use Extend History with an earlier date to import older reviews.' };
    }
    var sheet = cbrCreateReviewSheet(appName, source.store);
    var now = cbrNowIso();
    var app;
    try {
      app = cbrInsertApp({
        package_name: packageName, app_name: appName, sheet_id: sheet.getSheetId(),
        sheet_name: sheet.getName(), import_from_date: importFromDate,
        imported_until_date: '', operation_type: CBR_CONFIG.OPERATION.HISTORY,
        operation_cursor: '', status: CBR_CONFIG.STATUS.RUNNING,
        last_sync_at: '', last_error: '', created_at: now, updated_at: now,
        history_anchor_cursor: '', store: source.store, source_url: source.sourceUrl
      });
    } catch (error) {
      SpreadsheetApp.getActive().deleteSheet(sheet);
      throw error;
    }
    return cbrStartHistory(app);
  });
}

function uiContinueOperation(packageName) {
  return cbrWithDocumentLock(function() {
    var app = cbrFindApp(cbrValidatePackageName(packageName));
    if (!app) throw new Error('Configured app was not found.');
    return cbrContinue(app);
  });
}

function uiSyncNewReviews(packageName) {
  return cbrWithDocumentLock(function() {
    var app = cbrFindApp(cbrValidatePackageName(packageName));
    if (!app) throw new Error('Configured app was not found.');
    return cbrStartSync(app);
  });
}

function uiExtendHistory(packageName, requestedDate) {
  return cbrWithDocumentLock(function() {
    var app = cbrFindApp(cbrValidatePackageName(packageName));
    if (!app) throw new Error('Configured app was not found.');
    return cbrExtendHistory(app, requestedDate);
  });
}

function uiCancelSyncAndRepair(packageName) {
  return cbrWithDocumentLock(function() {
    var app = cbrFindApp(cbrValidatePackageName(packageName));
    if (!app) throw new Error('Configured app was not found.');
    if (app.status !== CBR_CONFIG.STATUS.PAUSED || app.operation_type !== CBR_CONFIG.OPERATION.SYNC) {
      throw new Error('Only a paused SYNC can be cancelled and repaired.');
    }
    var result;
    try {
      result = cbrRepairReviewsBeforeDate(cbrResolveAppSheet(app), app.import_from_date);
      cbrUpdateApp(app.package_name, {
        coverage_from_date: result.coverageFromDate, coverage_to_date: result.coverageToDate,
        operation_type: '', operation_cursor: '', status: CBR_CONFIG.STATUS.READY, last_error: ''
      });
    } catch (error) {
      try { cbrUpdateApp(app.package_name, { last_error: cbrPublicError(error).slice(0, 1000) }); } catch (ignored) {}
      try { cbrReconcileCoverage(cbrFindApp(app.package_name)); } catch (ignored) {}
      throw error;
    }
    result.message = 'Paused sync cancelled and out-of-range reviews removed.';
    return result;
  });
}
