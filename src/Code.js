function onOpen() {
  SpreadsheetApp.getUi().createMenu('CafeBazaar Reviews').addItem('Open Panel', 'showSidebar').addToUi();
}

function showSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('CafeBazaar Reviews');
  SpreadsheetApp.getUi().showSidebar(html);
}

function uiGetApps() {
  return cbrListApps().map(function(app) {
    return {
      package_name: app.package_name, app_name: app.app_name, sheet_id: app.sheet_id,
      sheet_name: app.sheet_name, import_from_date: app.import_from_date,
      imported_until_date: app.imported_until_date, operation_type: app.operation_type,
      status: app.status, last_sync_at: app.last_sync_at, last_error: app.last_error
    };
  });
}

function uiAddApp(payload) {
  return cbrWithDocumentLock(function() {
    var appName = String(payload && payload.appName || '').trim();
    var packageName = cbrValidatePackageName(payload && payload.packageName);
    var importFromDate = cbrNormalizeDate(payload && payload.importFromDate);
    if (!appName) throw new Error('App Name is required.');
    var existing = cbrFindApp(packageName);
    if (existing) {
      if (importFromDate < existing.import_from_date) return cbrExtendHistory(existing, importFromDate);
      return { message: 'This package is already configured. No new app or sheet was created. Use Extend History with an earlier date to import older reviews.' };
    }
    var sheet = cbrCreateReviewSheet(appName);
    var now = cbrNowIso();
    var app;
    try {
      app = cbrInsertApp({
        package_name: packageName, app_name: appName, sheet_id: sheet.getSheetId(),
        sheet_name: sheet.getName(), import_from_date: importFromDate,
        imported_until_date: '', operation_type: CBR_CONFIG.OPERATION.HISTORY,
        operation_cursor: '', status: CBR_CONFIG.STATUS.RUNNING,
        last_sync_at: '', last_error: '', created_at: now, updated_at: now,
        history_anchor_cursor: ''
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
    var result = cbrRepairReviewsBeforeDate(cbrResolveAppSheet(app), app.import_from_date);
    cbrUpdateApp(app.package_name, {
      operation_type: '', operation_cursor: '', status: CBR_CONFIG.STATUS.READY, last_error: ''
    });
    result.message = 'Paused sync cancelled and out-of-range reviews removed.';
    return result;
  });
}
