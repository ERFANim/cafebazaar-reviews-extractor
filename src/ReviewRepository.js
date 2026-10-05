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

function cbrCreateReviewSheet(appName) {
  var sheet = SpreadsheetApp.getActive().insertSheet(cbrSafeSheetName(appName));
  sheet.getRange(1, 1, 1, CBR_CONFIG.REVIEW_HEADERS.length).setValues([CBR_CONFIG.REVIEW_HEADERS]);
  sheet.setFrozenRows(1);
  var widths = [120, 95, 140, 55, 360, 95, 60, 60, 260, 75, 150, 220, 120, 170, 420];
  for (var i = 0; i < widths.length; i++) sheet.setColumnWidth(i + 1, widths[i]);
  return sheet;
}

function cbrLoadReviewIndex(sheet) {
  cbrValidateReviewSheet(sheet);
  var lastRow = sheet.getLastRow();
  var index = new Map();
  if (lastRow < 2) return index;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0]);
    if (id && !index.has(id)) index.set(id, i + 2);
  }
  return index;
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

function cbrUpsertReviews(sheet, reviews, index, fetchedAt) {
  var appended = [];
  var updates = [];
  var seenThisBatch = new Set();
  var newCount = 0;
  var updatedCount = 0;
  for (var i = 0; i < reviews.length; i++) {
    var id = cbrReviewId(reviews[i].id);
    var rowValues = cbrReviewToRow(reviews[i], fetchedAt);
    if (index.has(id)) {
      updates.push({ row: index.get(id), values: rowValues });
      updatedCount++;
    } else if (!seenThisBatch.has(id)) {
      appended.push(rowValues);
      seenThisBatch.add(id);
      newCount++;
    }
  }
  for (var u = 0; u < updates.length; u++) {
    sheet.getRange(updates[u].row, 1, 1, CBR_CONFIG.REVIEW_HEADERS.length).setValues([updates[u].values]);
  }
  if (appended.length) {
    var start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, appended.length, CBR_CONFIG.REVIEW_HEADERS.length).setValues(appended);
    for (var a = 0; a < appended.length; a++) index.set(String(appended[a][0]), start + a);
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
  if (count <= 0) return { rowsRemoved: 0, rowsPreserved: 0 };
  var rows = sheet.getRange(2, 1, count, CBR_CONFIG.REVIEW_HEADERS.length).getValues();
  var boundary = cbrNormalizeDate(importFromDate);
  var preserved = [];
  for (var i = 0; i < rows.length; i++) {
    var reviewDate = cbrNormalizeDate(rows[i][1]);
    if (reviewDate >= boundary) {
      rows[i][1] = reviewDate;
      preserved.push(rows[i]);
    }
  }
  if (preserved.length) sheet.getRange(2, 1, preserved.length, CBR_CONFIG.REVIEW_HEADERS.length).setValues(preserved);
  if (preserved.length < count) sheet.deleteRows(2 + preserved.length, count - preserved.length);
  cbrSortReviews(sheet);
  return { rowsRemoved: count - preserved.length, rowsPreserved: preserved.length };
}
