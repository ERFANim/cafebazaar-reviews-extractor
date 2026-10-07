function cbrSafeSheetName(appName) {
  var base = String(appName).trim().replace(/[\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) base = 'CafeBazaar App';
  base = base.slice(0, 90);
  var spreadsheet = SpreadsheetApp.getActive();
  var candidate = base;
  var suffix = 2;
  while (spreadsheet.getSheetByName(candidate)) {
    candidate = base.slice(0, 90 - String(suffix).length - 1) + ' ' + suffix;
    suffix++;
  }
  return candidate;
}

function cbrCreateReviewSheet(appName, store) {
  var sheetName = appName + ' - ' + cbrStoreDisplayName(store || CBR_CONFIG.STORE.CAFEBAZAAR);
  var sheet = SpreadsheetApp.getActive().insertSheet(cbrSafeSheetName(sheetName));
  sheet.getRange(1, 1, 1, CBR_CONFIG.REVIEW_HEADERS.length).setValues([CBR_CONFIG.REVIEW_HEADERS]);
  sheet.setFrozenRows(1);
  var widths = [120, 95, 140, 55, 360, 95, 60, 60, 260, 75, 150, 220, 120, 170, 420];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
  return sheet;
}

function cbrLoadReviewState(sheet) {
  cbrValidateReviewSheet(sheet);
  var lastRow = sheet.getLastRow();
  var state = { index: new Map(), datesById: new Map(), dateCounts: new Map() };
  if (lastRow < 2) return state;
  var cells = sheet.getRange(2, 1, lastRow - 1, 2);
  var ids = cells.getDisplayValues();
  var values = cells.getValues();
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0]);
    var date = cbrNormalizeDate(values[i][1]);
    cbrAdjustDateCount(state.dateCounts, date, 1);
    if (id && !state.index.has(id)) {
      state.index.set(id, i + 2);
      state.datesById.set(id, date);
    }
  }
  return state;
}

function cbrAdjustDateCount(counts, date, delta) {
  var next = (counts.get(date) || 0) + delta;
  if (next > 0) counts.set(date, next);
  else counts.delete(date);
}

function cbrCoverageFromState(state) {
  var oldest = '';
  var newest = '';
  state.dateCounts.forEach(function(count, date) {
    if (!oldest || date < oldest) oldest = date;
    if (!newest || date > newest) newest = date;
  });
  return { oldest: oldest, newest: newest };
}

function cbrValidateReviewSheet(sheet) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() !== CBR_CONFIG.REVIEW_HEADERS.length) {
    throw new Error('Review sheet "' + sheet.getName() + '" has an invalid schema.');
  }
  var headers = sheet.getRange(1, 1, 1, CBR_CONFIG.REVIEW_HEADERS.length).getDisplayValues()[0];
  if (headers.join('\u001f') !== CBR_CONFIG.REVIEW_HEADERS.join('\u001f')) {
    throw new Error('Review sheet "' + sheet.getName() + '" has unexpected headers.');
  }
}

function cbrGetImportedDateRange(sheet) {
  cbrValidateReviewSheet(sheet);
  var count = sheet.getLastRow() - 1;
  if (count <= 0) return { oldest: '', newest: '' };
  var dates = sheet.getRange(2, 2, count, 1).getValues();
  var oldest = '';
  var newest = '';
  for (var i = 0; i < dates.length; i++) {
    var date = cbrNormalizeDate(dates[i][0]);
    if (!oldest || date < oldest) oldest = date;
    if (!newest || date > newest) newest = date;
  }
  return { oldest: oldest, newest: newest };
}

function cbrUpsertReviews(sheet, reviews, state, fetchedAt) {
  var appended = [];
  var updates = [];
  var seenThisBatch = new Set();
  var newCount = 0;
  var updatedCount = 0;
  for (var i = 0; i < reviews.length; i++) {
    var id = cbrReviewId(reviews[i].id);
    var rowValues = cbrReviewToRow(reviews[i], fetchedAt);
    if (state.index.has(id)) {
      updates.push({ id: id, row: state.index.get(id), values: rowValues });
      updatedCount++;
    } else if (!seenThisBatch.has(id)) {
      appended.push(rowValues);
      seenThisBatch.add(id);
      newCount++;
    }
  }
  for (var u = 0; u < updates.length; u++) {
    sheet.getRange(updates[u].row, 1, 1, CBR_CONFIG.REVIEW_HEADERS.length).setValues([updates[u].values]);
    var oldDate = state.datesById.get(updates[u].id);
    var newDate = updates[u].values[1];
    if (oldDate !== newDate) {
      cbrAdjustDateCount(state.dateCounts, oldDate, -1);
      cbrAdjustDateCount(state.dateCounts, newDate, 1);
      state.datesById.set(updates[u].id, newDate);
    }
  }
  if (appended.length) {
    var start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, appended.length, CBR_CONFIG.REVIEW_HEADERS.length).setValues(appended);
    for (var a = 0; a < appended.length; a++) {
      var appendedId = String(appended[a][0]);
      state.index.set(appendedId, start + a);
      state.datesById.set(appendedId, appended[a][1]);
      cbrAdjustDateCount(state.dateCounts, appended[a][1], 1);
    }
  }
  return { newCount: newCount, updatedCount: updatedCount, processedCount: reviews.length };
}

function cbrSortReviews(sheet) {
  if (sheet.getLastRow() > 2) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, CBR_CONFIG.REVIEW_HEADERS.length)
      .sort([{ column: 2, ascending: false }]);
  }
}

function cbrRepairReviewsBeforeDate(sheet, importFromDate) {
  cbrValidateReviewSheet(sheet);
  var count = sheet.getLastRow() - 1;
  if (count <= 0) return { rowsRemoved: 0, rowsPreserved: 0, coverageFromDate: '', coverageToDate: '' };
  var rows = sheet.getRange(2, 1, count, CBR_CONFIG.REVIEW_HEADERS.length).getValues();
  var boundary = cbrNormalizeDate(importFromDate);
  var preserved = [];
  var oldest = '';
  var newest = '';
  for (var i = 0; i < rows.length; i++) {
    var reviewDate = cbrNormalizeDate(rows[i][1]);
    if (reviewDate >= boundary) {
      rows[i][1] = reviewDate;
      preserved.push(rows[i]);
      if (!oldest || reviewDate < oldest) oldest = reviewDate;
      if (!newest || reviewDate > newest) newest = reviewDate;
    }
  }
  if (preserved.length) sheet.getRange(2, 1, preserved.length, CBR_CONFIG.REVIEW_HEADERS.length).setValues(preserved);
  if (preserved.length < count) sheet.deleteRows(2 + preserved.length, count - preserved.length);
  cbrSortReviews(sheet);
  return { rowsRemoved: count - preserved.length, rowsPreserved: preserved.length,
    coverageFromDate: oldest, coverageToDate: newest };
}
