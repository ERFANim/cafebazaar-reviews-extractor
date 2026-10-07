function cbrWithDocumentLock(action) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(CBR_CONFIG.LOCK_WAIT_MS)) throw new Error('Another CafeBazaar operation is running. Please try again shortly.');
  try { return action(); } finally { lock.releaseLock(); }
}

function cbrValidatePackageName(value) {
  var packageName = String(value || '').trim();
  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(packageName)) {
    throw new Error('Enter a valid package name, for example com.example.app.');
  }
  return packageName;
}

function cbrNormalizeAppIdentifier(value) {
  var input = String(value == null ? '' : value).trim();
  if (!input) throw new Error('Enter a CafeBazaar app link or package name.');
  if (!/[\/?#]/.test(input)) return cbrValidatePackageName(input);
  if (/\s/.test(input)) throw new Error('Enter a valid CafeBazaar app link without spaces.');

  var url = /^https:\/\/([^/?#]+)(\/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i.exec(input);
  if (!url) throw new Error('Enter a valid CafeBazaar app link starting with https://cafebazaar.ir/app/.');
  var host = url[1].toLowerCase();
  if (host !== 'cafebazaar.ir' && host !== 'www.cafebazaar.ir') {
    throw new Error('Only cafebazaar.ir app links are supported.');
  }
  var appPath = /^\/app\/([^/]+)\/?$/.exec(url[2] || '');
  if (!appPath) throw new Error('CafeBazaar app link must have /app/<package_name>.');
  return cbrValidatePackageName(appPath[1]);
}

function cbrNormalizeAppSource(value) {
  var packageName = cbrNormalizeAppIdentifier(value);
  return {
    store: CBR_CONFIG.STORE.CAFEBAZAAR,
    packageName: packageName,
    sourceUrl: cbrCafeBazaarSourceUrl(packageName)
  };
}

function cbrRecordOperationError(packageName, error) {
  var message = cbrPublicError(error).slice(0, 1000);
  try { cbrUpdateApp(packageName, { status: CBR_CONFIG.STATUS.ERROR, last_error: message }); } catch (ignored) {}
  try { cbrReconcileCoverage(cbrFindApp(packageName)); } catch (ignored) {}
  throw new Error(message);
}

function cbrReconcileCoverage(app) {
  if (!app) throw new Error('Configured app was not found.');
  var sheet = cbrFindSheetById(SpreadsheetApp.getActive().getSheets(), app.sheet_id);
  if (!sheet) throw new Error('Review sheet is missing.');
  var range = cbrGetImportedDateRange(sheet);
  cbrUpdateApp(app.package_name, {
    coverage_from_date: range.oldest, coverage_to_date: range.newest
  });
  return range;
}

function cbrStartHistory(app) {
  var provider = cbrGetReviewProvider(app.store);
  cbrUpdateApp(app.package_name, {
    operation_type: CBR_CONFIG.OPERATION.HISTORY, operation_cursor: '',
    status: CBR_CONFIG.STATUS.RUNNING, last_error: ''
  });
  try { return cbrRunHistory(cbrFindApp(app.package_name, app.store), '', provider); }
  catch (error) { return cbrRecordOperationError(app.package_name, error); }
}

function cbrExtendHistory(app, requestedDate) {
  var target = cbrNormalizeDate(requestedDate);
  if (app.operation_type || app.status !== CBR_CONFIG.STATUS.READY) {
    throw new Error('Finish or repair the current operation before extending history.');
  }
  if (target === app.import_from_date) return { message: 'Nothing to import; this date is already configured.' };
  if (target > app.import_from_date) {
    return { message: 'V1 only extends history to an earlier date. Existing reviews were not deleted or narrowed.' };
  }
  var provider = cbrGetReviewProvider(app.store);
  var anchor = app.history_anchor_cursor || '';
  cbrUpdateApp(app.package_name, {
    import_from_date: target, operation_type: CBR_CONFIG.OPERATION.HISTORY,
    operation_cursor: anchor, status: CBR_CONFIG.STATUS.RUNNING, last_error: ''
  });
  try { return cbrRunHistory(cbrFindApp(app.package_name, app.store), anchor, provider); }
  catch (error) { return cbrRecordOperationError(app.package_name, error); }
}

function cbrStartSync(app) {
  if (app.operation_type) throw new Error('This app already has a resumable operation. Use Continue.');
  var provider = cbrGetReviewProvider(app.store);
  cbrUpdateApp(app.package_name, {
    operation_type: CBR_CONFIG.OPERATION.SYNC, operation_cursor: '',
    status: CBR_CONFIG.STATUS.RUNNING, last_error: ''
  });
  try { return cbrRunSync(cbrFindApp(app.package_name, app.store), '', provider); }
  catch (error) { return cbrRecordOperationError(app.package_name, error); }
}

function cbrContinue(app) {
  if (app.operation_type !== CBR_CONFIG.OPERATION.HISTORY && app.operation_type !== CBR_CONFIG.OPERATION.SYNC) {
    throw new Error('There is no resumable operation for this app.');
  }
  if (!app.operation_cursor && app.status !== CBR_CONFIG.STATUS.ERROR) {
    throw new Error('The resumable operation has no saved cursor. Start a new operation instead.');
  }
  var provider = cbrGetReviewProvider(app.store);
  cbrUpdateApp(app.package_name, { status: CBR_CONFIG.STATUS.RUNNING, last_error: '' });
  try {
    return app.operation_type === CBR_CONFIG.OPERATION.HISTORY
      ? cbrRunHistory(cbrFindApp(app.package_name, app.store), app.operation_cursor || '', provider)
      : cbrRunSync(cbrFindApp(app.package_name, app.store), app.operation_cursor || '', provider);
  } catch (error) { return cbrRecordOperationError(app.package_name, error); }
}
