function cbrEnsureReadmeSheet() {
  var spreadsheet = SpreadsheetApp.getActive();
  var existing = spreadsheet.getSheetByName('README');
  if (existing) return existing;
  return cbrWithDocumentLock(function() {
    return spreadsheet.getSheetByName('README') || cbrCreateReadmeSheet(spreadsheet);
  });
}

function cbrCreateReadmeSheet(spreadsheet) {
  var sheet = spreadsheet.insertSheet('README', 0);
  var lines = [
    'CafeBazaar Reviews Extractor',
    'This Sheet imports and syncs app reviews into separate review tabs.',
    '',
    'Quick Start',
    '1. Open CafeBazaar Reviews → Open Panel.',
    '2. Enter an App Name.',
    '3. Paste the CafeBazaar App Link.',
    '4. Choose Import From Date.',
    '5. Click Add & Import.',
    '',
    'Keep reviews updated',
    'Sync New Reviews — fetch new reviews and refresh existing review data.',
    'Extend History — import older reviews.',
    'Continue Import or Continue Sync — resume a paused operation.',
    'Retry — retry after an error.',
    '',
    'Important',
    'Each app/store source has its own review sheet.',
    'Existing reviews may be updated during Sync.',
    'Do not edit the internal Apps sheet manually.',
    'Currently implemented marketplace: CafeBazaar.',
    '',
    'Technical documentation',
    'GitHub repository'
  ];
  sheet.getRange(1, 1, lines.length, 1).setValues(lines.map(function(line) { return [line]; }));
  sheet.setColumnWidth(1, 650);
  sheet.getRange(1, 1, lines.length, 1).setWrap(true).setFontFamily('Arial').setFontSize(11);
  sheet.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  [4, 11, 17, 23].forEach(function(row) {
    sheet.getRange(row, 1).setFontSize(12).setFontWeight('bold');
  });
  sheet.getRange(24, 1).setRichTextValue(SpreadsheetApp.newRichTextValue()
    .setText('GitHub repository')
    .setLinkUrl('https://github.com/ERFANim/cafebazaar-reviews-extractor')
    .build());
  return sheet;
}
