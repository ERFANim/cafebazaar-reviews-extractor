'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const files = [
  'Config.js', 'Utils.js', 'CafeBazaarApi.js', 'CafeBazaarProvider.js',
  'ProviderRegistry.js', 'AppRepository.js', 'ReviewRepository.js',
  'HistoryImportService.js', 'SyncService.js', 'OperationService.js', 'Code.js'
];

class Sheet {
  constructor(name, id, rows) {
    this.name = name; this.id = id; this.rows = rows.map(row => [...row]);
    this.maxColumns = 26; this.hidden = false; this.note = ''; this.protections = []; this.frozenRows = 0;
  }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map(row => row.length)); }
  getMaxColumns() { return this.maxColumns; }
  insertColumnsAfter(column, count) { this.maxColumns += count; }
  getRange(row, column, height = 1, width = 1) {
    const sheet = this;
    return {
      getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => sheet.rows[row + i - 1]?.[column + j - 1] ?? '')); },
      getDisplayValues() { return this.getValues().map(values => values.map(value => String(value))); },
      setValues(values) {
        for (let i = 0; i < values.length; i++) {
          while (sheet.rows.length < row + i) sheet.rows.push([]);
          for (let j = 0; j < values[i].length; j++) sheet.rows[row + i - 1][column + j - 1] = values[i][j];
        }
      },
      setValue(value) { this.setValues([[value]]); },
      getNote() { return row === 1 && column === 1 ? sheet.note : ''; },
      setNote(note) { if (row === 1 && column === 1) sheet.note = note; },
      sort() { sheet.rows.splice(row - 1, height, ...sheet.rows.slice(row - 1, row - 1 + height).sort((a, b) => String(b[1]).localeCompare(String(a[1])))); }
    };
  }
  deleteRows(start, count) { this.rows.splice(start - 1, count); }
  setFrozenRows(count) { this.frozenRows = count; }
  setColumnWidth() {}
  autoResizeColumns() {}
  isSheetHidden() { return this.hidden; }
  hideSheet() { this.hidden = true; }
  getProtections() { return this.protections; }
  protect() {
    if (this.protections.length) return this.protections[0];
    const protection = {
      description: '', warningOnly: false,
      getDescription() { return this.description; },
      setDescription(value) { this.description = value; return this; },
      isWarningOnly() { return this.warningOnly; },
      setWarningOnly(value) { this.warningOnly = value; return this; }
    };
    this.protections.push(protection);
    return protection;
  }
}

function setup(options = {}) {
  const config = require('../src/Config.js');
  const schemaColumns = options.schemaColumns || (options.oldSchema === false ? 14 : 13);
  const appRows = options.appRows || [[
    'com.example.app', 'Example', 42, 'Example', new Date(2026, 9, 1),
    '2026-10-01', '', '', 'READY', 'previous-sync', '', 'created', 'updated'
  ]];
  const apps = new Sheet('Apps', 1, [config.APPS_HEADERS.slice(0, schemaColumns), ...appRows]);
  const reviews = new Sheet('Example', 42, [[...config.REVIEW_HEADERS], ...(options.reviews || [])]);
  const other = new Sheet('Other app', 77, [[...config.REVIEW_HEADERS], ['999', '2026-09-01']]);
  const sheets = [apps, reviews, other];
  const spreadsheet = {
    getSheetByName(name) { return sheets.find(sheet => sheet.name === name) || null; },
    getSheets() { return sheets; },
    getSpreadsheetTimeZone() { return options.timeZone || 'Asia/Tehran'; },
    insertSheet(name) {
      const sheet = new Sheet(name, Math.max(...sheets.map(item => item.id)) + 1, []);
      sheets.push(sheet);
      return sheet;
    },
    deleteSheet(sheet) { sheets.splice(sheets.indexOf(sheet), 1); }
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActive: () => spreadsheet, ProtectionType: { SHEET: 'SHEET' } },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    console, Date, Map, Set
  });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context, { filename: file });
  const requested = [];
  const pages = new Map();
  context.cbrFetchReviewPage = (pkg, cursor) => {
    requested.push({ pkg, cursor });
    if (!pages.has(cursor)) throw Error('No mock page for cursor: ' + cursor);
    return pages.get(cursor);
  };
  return { context, apps, reviews, other, pages, requested, config };
}

function review(id, date, comment = 'original') {
  return { id, date, user: 'احمد', rate: 5, comment, likes: 1, total: 1, reply: null, isEdited: false };
}
function row(id, date, comment = 'old') { return [String(id), date, 'احمد', 5, comment, '', 1, 1, '', false, '', '', 0, '', '{}']; }
function page(reviews, nextPageCursor = '') { return { reviews, nextPageCursor }; }
function appState(env) { return env.context.cbrFindApp('com.example.app'); }
function ids(env) { return env.reviews.rows.slice(1).map(values => String(values[0])); }

function renderSidebarCard(app) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'Sidebar.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const appsElement = { innerHTML: '' };
  const run = {
    withSuccessHandler() { return this; }, withFailureHandler() { return this; }, uiGetApps() {}
  };
  const context = vm.createContext({
    document: { getElementById: () => appsElement, querySelectorAll: () => [] },
    google: { script: { run } }
  });
  vm.runInContext(script, context);
  context.renderApps([app]);
  return appsElement.innerHTML;
}

test('Apps schema migration appends anchor, coverage, and source columns without changing existing rows', () => {
  const env = setup();
  const before = env.apps.rows[1].slice();
  const found = appState(env);
  assert.equal(env.apps.rows[0][13], 'history_anchor_cursor');
  assert.equal(env.apps.rows[0][14], 'coverage_from_date');
  assert.equal(env.apps.rows[0][15], 'coverage_to_date');
  assert.equal(env.apps.rows[0][16], 'store');
  assert.equal(env.apps.rows[0][17], 'source_url');
  assert.deepEqual(env.apps.rows[1].slice(0, 13), before);
  assert.equal(found.import_from_date, '2026-10-01');
  assert.equal(found.history_anchor_cursor, '');
  assert.equal(found.coverage_from_date, '');
  assert.equal(found.coverage_to_date, '');
  assert.equal(found.store, 'cafebazaar');
  assert.equal(found.source_url, 'https://cafebazaar.ir/app/com.example.app');
});

test('schema migration preserves two separate app records', () => {
  const first = ['com.example.app', 'Example', 42, 'Example', new Date(2026, 9, 1), '2026-10-01', '', '', 'READY', '', '', '', ''];
  const second = ['com.other.app', 'Other app', 77, 'Other app', '2026-09-01', '2026-09-01', '', '', 'READY', '', '', '', ''];
  const env = setup({ appRows: [first, second] });
  const apps = env.context.cbrListApps();
  assert.equal(apps.length, 2);
  assert.deepEqual(Array.from(apps, app => app.sheet_id), [42, 77]);
  assert.deepEqual(env.apps.rows[2].slice(0, 13), second);
});

test('14-column Apps schema migrates in place and backfills by sheet ID', () => {
  const appRow = ['com.example.app', 'Example', 42, 'Old tab name', '2026-10-01', '2026-10-01',
    '', '', 'READY', '', '', '', '', 'saved-anchor'];
  const env = setup({ schemaColumns: 14, appRows: [appRow], reviews: [
    row(1, new Date(2026, 9, 6)), row(2, '2026/10/03')
  ] });
  const app = env.context.uiGetApps()[0];
  assert.deepEqual(env.apps.rows[0].slice(13), ['history_anchor_cursor', 'coverage_from_date', 'coverage_to_date', 'store', 'source_url']);
  assert.deepEqual(env.apps.rows[1].slice(0, 14), appRow);
  assert.equal(app.coverage_from_date, '2026-10-03');
  assert.equal(app.coverage_to_date, '2026-10-06');
});

test('16-column Apps rows gain canonical source metadata without changing operational values or tab names', () => {
  const appRow = ['com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-03',
    'HISTORY', 'saved-cursor', 'PAUSED', 'previous-sync', '', 'created', 'updated',
    'boundary-anchor', '2026-10-03', '2026-10-06'];
  const env = setup({ schemaColumns: 16, appRows: [appRow], reviews: [row(1, '2026-10-03')] });
  const app = env.context.uiGetApps()[0];
  assert.deepEqual(env.apps.rows[0].slice(16), ['store', 'source_url']);
  assert.deepEqual(env.apps.rows[1].slice(0, 16), appRow);
  assert.deepEqual(env.apps.rows[1].slice(16), ['cafebazaar', 'https://cafebazaar.ir/app/com.example.app']);
  assert.equal(app.store, 'cafebazaar');
  assert.equal(app.store_label, 'CafeBazaar');
  assert.equal(env.reviews.getName(), 'Example');
  assert.equal(app.sheet_name, 'Example');
});

test('partial source-column migration completes and canonicalizes CafeBazaar URLs', () => {
  const base = ['com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-01',
    '', '', 'READY', '', '', '', '', '', '2026-10-01', '2026-10-06'];
  const partial = setup({ schemaColumns: 17, appRows: [[...base, 'cafebazaar']] });
  partial.context.uiGetApps();
  assert.equal(partial.apps.rows[0][17], 'source_url');
  assert.equal(partial.apps.rows[1][17], 'https://cafebazaar.ir/app/com.example.app');

  const noncanonical = setup({ schemaColumns: 18, appRows: [[...base, 'cafebazaar',
    'https://www.cafebazaar.ir/app/com.example.app/?l=en']] });
  noncanonical.context.uiGetApps();
  assert.equal(noncanonical.apps.rows[1][17], 'https://cafebazaar.ir/app/com.example.app');
});

test('Apps migration is idempotent and marks the registry as internal without blocking edits', () => {
  const env = setup({ schemaColumns: 16 });
  env.context.uiGetApps();
  const rowsAfterFirst = JSON.stringify(env.apps.rows);
  env.context.uiGetApps();
  assert.equal(JSON.stringify(env.apps.rows), rowsAfterFirst);
  assert.equal(env.apps.frozenRows, 1);
  assert.equal(env.apps.isSheetHidden(), true);
  assert.match(env.apps.note, /Internal.*Do not edit/i);
  assert.equal(env.apps.protections.length, 1);
  assert.equal(env.apps.protections[0].isWarningOnly(), true);
  assert.equal(env.context.cbrFindApp('com.example.app').store, 'cafebazaar');
});

test('repository resolves Apps by name even while the registry tab is hidden', () => {
  const env = setup({ schemaColumns: 16 });
  env.context.uiGetApps();
  assert.equal(env.apps.isSheetHidden(), true);
  assert.equal(env.context.cbrFindApp('com.example.app').sheet_id, 42);
  assert.equal(env.context.cbrResolveAppSheet(env.context.cbrFindApp('com.example.app')).getSheetId(), 42);
});

test('Apps hides when another tab is visible but remains usable as the sole visible tab', () => {
  const env = setup({ schemaColumns: 16 });
  env.reviews.hidden = true;
  env.other.hidden = true;
  env.context.uiGetApps();
  assert.equal(env.apps.isSheetHidden(), false);
  assert.equal(env.context.cbrFindApp('com.example.app').store, 'cafebazaar');
  env.reviews.hidden = false;
  env.context.uiGetApps();
  assert.equal(env.apps.isSheetHidden(), true);
});

test('migration expands a narrow Apps grid before appending coverage columns', () => {
  const env = setup({ schemaColumns: 14 });
  env.apps.maxColumns = 14;
  env.context.uiGetApps();
  assert.equal(env.apps.getMaxColumns(), 18);
  assert.equal(env.apps.rows[0][15], 'coverage_to_date');
});

test('migration completes a partially appended 15-column header', () => {
  const env = setup({ schemaColumns: 15, reviews: [row(1, '2026-10-04')] });
  env.context.uiGetApps();
  assert.equal(env.apps.rows[0][15], 'coverage_to_date');
  assert.deepEqual(env.apps.rows[1].slice(14, 16), ['2026-10-04', '2026-10-04']);
});

test('interrupted coverage backfill retries missing values without rescanning filled rows', () => {
  const appRow = ['com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-01',
    '', '', 'READY', '', '', '', '', 'anchor', '2026-10-03', ''];
  const env = setup({ schemaColumns: 16, appRows: [appRow], reviews: [row(1, '2026-10-03'), row(2, '2026-10-06')] });
  assert.equal(env.context.uiGetApps()[0].coverage_to_date, '2026-10-06');
  env.context.cbrGetImportedDateRange = () => { throw Error('Unexpected date-column scan'); };
  assert.equal(env.context.uiGetApps()[0].coverage_from_date, '2026-10-03');
});

test('empty review sheet clears stale coverage without altering history progress', () => {
  const appRow = ['com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-01',
    '', '', 'READY', '', '', '', '', 'anchor', '2026-10-01', '2026-10-06'];
  const env = setup({ schemaColumns: 16, appRows: [appRow] });
  const app = env.context.uiGetApps()[0];
  assert.equal(app.coverage_from_date, '');
  assert.equal(app.coverage_to_date, '');
  assert.equal(app.imported_until_date, '2026-10-01');
});

test('coverage backfill keeps two apps isolated by numeric sheet ID', () => {
  const first = ['com.example.app', 'Example', 42, 'Renamed elsewhere', '2026-10-01', '', '', '', 'READY', '', '', '', '', ''];
  const second = ['com.other.app', 'Other app', 77, 'Other app', '2026-09-01', '', '', '', 'READY', '', '', '', '', ''];
  const env = setup({ schemaColumns: 14, appRows: [first, second], reviews: [row(1, '2026-10-06')] });
  const apps = env.context.uiGetApps();
  assert.equal(apps[0].coverage_from_date, '2026-10-06');
  assert.equal(apps[1].coverage_from_date, '2026-09-01');
  assert.deepEqual(env.apps.rows[1].slice(14, 16), ['2026-10-06', '2026-10-06']);
  assert.deepEqual(env.apps.rows[2].slice(14, 16), ['2026-09-01', '2026-09-01']);
});

test('native Date coverage cells are serialized as canonical strings for the Sidebar', () => {
  const appRow = ['com.example.app', 'Example', 42, 'Example', new Date(2026, 9, 1),
    '2026-10-01', '', '', 'READY', '', '', '', '', '', new Date(2026, 9, 3), new Date(2026, 9, 6)];
  const env = setup({ schemaColumns: 16, appRows: [appRow], reviews: [row(1, '2026-10-03'), row(2, '2026-10-06')] });
  const app = env.context.uiGetApps()[0];
  assert.equal(app.coverage_from_date, '2026-10-03');
  assert.equal(app.coverage_to_date, '2026-10-06');
  assert.equal(typeof app.coverage_from_date, 'string');
});

test('Apps coverage backfills actual oldest and newest dates from unsorted rows', () => {
  const env = setup({ reviews: [
    row(1, '2026-10-03'),
    row(2, new Date(2026, 9, 5)),
    row(3, '2026/10/02')
  ] });
  const app = env.context.uiGetApps()[0];
  assert.equal(app.import_from_date, '2026-10-01');
  assert.equal(app.imported_until_date, '2026-10-01');
  assert.equal(app.coverage_from_date, '2026-10-02');
  assert.equal(app.coverage_to_date, '2026-10-05');
  assert.equal(typeof app.coverage_to_date, 'string');
  assert.deepEqual(env.apps.rows[1].slice(14, 16), ['2026-10-02', '2026-10-05']);
});

test('Sidebar app data reports an empty review sheet without inventing dates', () => {
  const env = setup();
  const app = env.context.uiGetApps()[0];
  assert.equal(app.coverage_from_date, '');
  assert.equal(app.coverage_to_date, '');
  assert.equal(app.review_sheet_missing, false);
});

test('Sidebar sync timestamp uses spreadsheet timezone without changing stored value', () => {
  const timestamp = '2026-10-07T05:58:14.699Z';
  const appRow = ['com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-01',
    '', '', 'READY', timestamp, '', '', '', '', '2026-10-01', '2026-10-07'];
  const env = setup({ schemaColumns: 16, appRows: [appRow], reviews: [row(1, '2026-10-01')] });
  const calls = [];
  env.context.Utilities = { formatDate(date, timeZone, pattern) {
    calls.push({ timeZone, pattern, instant: date.toISOString() });
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  } };
  const app = env.context.uiGetApps()[0];
  assert.equal(app.last_sync_display, '2026-10-07 09:28');
  assert.equal(app.last_sync_at, timestamp);
  assert.equal(env.apps.rows[1][9], timestamp);
  assert.deepEqual(calls, [{ timeZone: 'Asia/Tehran', pattern: 'yyyy-MM-dd HH:mm', instant: timestamp }]);
  assert.equal(app.status, 'READY');
  assert.equal(env.context.cbrFormatLastSyncForUi('', 'Asia/Tehran'), '—');
});

test('Sidebar card separates requested and actual coverage dates and humanizes status', () => {
  const app = {
    app_name: 'blu', package_name: 'com.samanpr.blu', sheet_id: 42, sheet_name: 'blu',
    import_from_date: '2026-10-01', imported_until_date: '2026-09-20',
    coverage_from_date: '2026-10-03', coverage_to_date: '2026-10-07',
    status: 'READY', operation_type: '', last_sync_at: '2026-10-07T05:58:14.699Z',
    last_sync_display: '2026-10-07 09:28'
  };
  const html = renderSidebarCard(app);
  assert.match(html, /Requested from:<\/div><div class="dateValue">2026-10-01/);
  assert.match(html, /Reviews imported from:<\/div><div class="dateValue">2026-10-03/);
  assert.match(html, /Reviews imported through:<\/div><div class="dateValue">2026-10-07/);
  assert.match(html, /Status: <span class="status">Ready<\/span>/);
  assert.match(html, /Last synced: 2026-10-07 09:28/);
  assert.match(html, /Sync New Reviews/);
  assert.match(html, /Extend History/);
  assert.doesNotMatch(html, /2026-10-07T05:58:14\.699Z|2026-09-20/);
  assert.equal(app.status, 'READY');
  assert.equal(app.last_sync_at, '2026-10-07T05:58:14.699Z');
});

test('Sidebar card shows an empty coverage message and preserves operation actions', () => {
  const base = { app_name: 'Example', package_name: 'com.example.app', sheet_id: 42,
    sheet_name: 'Example', import_from_date: '2026-10-01',
    coverage_from_date: '', coverage_to_date: '', last_sync_display: '—' };
  const pausedSync = renderSidebarCard({ ...base, status: 'PAUSED', operation_type: 'SYNC' });
  assert.match(pausedSync, /No reviews imported yet/);
  assert.doesNotMatch(pausedSync, /Reviews imported from:|Reviews imported through:/);
  assert.match(pausedSync, /Status: <span class="status">Paused<\/span>/);
  assert.match(pausedSync, /Last synced: —/);
  assert.match(pausedSync, /Cancel Sync &amp; Repair/);
  assert.match(pausedSync, /Continue Sync/);
  assert.match(renderSidebarCard({ ...base, status: 'PAUSED', operation_type: 'HISTORY' }), /Continue Import/);
  const errorCard = renderSidebarCard({ ...base, status: 'ERROR', operation_type: 'HISTORY' });
  assert.match(errorCard, /Status: <span class="status">Error<\/span>/);
  assert.match(errorCard, /Retry/);
  assert.match(renderSidebarCard({ ...base, status: 'RUNNING', operation_type: 'HISTORY' }), /Status: <span class="status">Running<\/span>/);
});

test('sync upserts in-range rows, ignores older unknown IDs, and stops on mixed page', () => {
  const env = setup({ reviews: [row(1, '2026-10-01')] });
  env.pages.set('', page([review(2, '2026/10/02'), review(1, '2026/10/01', 'edited'), review(3, '2026/09/30')], 'next'));
  const result = env.context.uiSyncNewReviews('com.example.app');
  assert.deepEqual(ids(env).sort(), ['1', '2']);
  assert.equal(env.reviews.rows.find(values => values[0] === '1')[4], 'edited');
  assert.equal(result.newReviews, 1);
  assert.equal(result.updatedReviews, 1);
  assert.equal(result.pagesFetched, 1);
  assert.equal(appState(env).status, 'READY');
  assert.deepEqual(env.requested.map(item => item.cursor), ['']);
});

test('older unknown IDs alone stop sync without being inserted', () => {
  const env = setup();
  env.pages.set('', page([review(3, '2026/09/30')], 'next'));
  env.context.uiSyncNewReviews('com.example.app');
  assert.deepEqual(ids(env), []);
  assert.equal(env.requested.length, 1);
});

test('fully known page stops, while partially known page continues', () => {
  const env = setup({ reviews: [row(1, '2026-10-01'), row(2, '2026-10-02')] });
  env.pages.set('', page([review(3, '2026/10/03'), review(2, '2026/10/02')], 'second'));
  env.pages.set('second', page([review(1, '2026/10/01', 'edited')], 'third'));
  env.context.uiSyncNewReviews('com.example.app');
  assert.deepEqual(env.requested.map(item => item.cursor), ['', 'second']);
  assert.equal(env.reviews.rows.find(values => values[0] === '1')[4], 'edited');
});

test('initial history stores current boundary-page cursor, not next cursor', () => {
  const env = setup({ appRows: [['com.example.app', 'Example', 42, 'Example', '2026-10-01', '', 'HISTORY', '', 'ERROR', '', '', '', '']] });
  env.pages.set('', page([review(3, '2026/10/03')], 'boundary'));
  env.pages.set('boundary', page([review(2, '2026/10/01'), review(1, '2026/09/30')], 'later'));
  env.context.uiContinueOperation('com.example.app');
  assert.equal(appState(env).history_anchor_cursor, 'boundary');
  assert.equal(appState(env).imported_until_date, '2026-10-01');
  assert.deepEqual(ids(env).sort(), ['2', '3']);
});

test('Extend History re-fetches boundary page, adds missing range once, and saves new anchor', () => {
  const env = setup({ oldSchema: false, appRows: [[
    'com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-01', '', '', 'READY', '', '', '', '', 'old-boundary'
  ]], reviews: [row(4, '2026-10-01')] });
  env.pages.set('old-boundary', page([review(4, '2026/10/01'), review(3, '2026/09/30')], 'new-boundary'));
  env.pages.set('new-boundary', page([review(2, '2026/09/01'), review(1, '2026/08/31')], 'later'));
  const result = env.context.uiExtendHistory('com.example.app', '2026-09-01');
  assert.deepEqual(env.requested.map(item => item.cursor), ['old-boundary', 'new-boundary']);
  assert.deepEqual(ids(env).sort(), ['2', '3', '4']);
  assert.equal(result.newReviews, 2);
  assert.equal(appState(env).history_anchor_cursor, 'new-boundary');
  assert.equal(appState(env).import_from_date, '2026-09-01');
  assert.equal(appState(env).imported_until_date, '2026-09-01');
});

test('Extend History can pause and resume from operation_cursor', () => {
  const env = setup({ oldSchema: false, appRows: [[
    'com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-01', '', '', 'READY', '', '', '', '', 'anchor'
  ]] });
  env.context.CBR_CONFIG = Object.freeze({ ...env.context.CBR_CONFIG, SOFT_DEADLINE_MS: -1 });
  env.pages.set('anchor', page([review(3, '2026/09/30')], 'resume-here'));
  env.pages.set('resume-here', page([review(2, '2026/09/01'), review(1, '2026/08/31')], 'later'));
  const first = env.context.uiExtendHistory('com.example.app', '2026-09-01');
  assert.equal(first.paused, true);
  assert.equal(appState(env).operation_cursor, 'resume-here');
  env.context.uiContinueOperation('com.example.app');
  assert.deepEqual(env.requested.map(item => item.cursor), ['anchor', 'resume-here']);
  assert.equal(appState(env).history_anchor_cursor, 'resume-here');
  assert.equal(appState(env).status, 'READY');
});

test('same and newer extension requests leave metadata and rows unchanged', () => {
  const env = setup({ reviews: [row(1, '2026-10-01')] });
  appState(env); // Apply the append-only Apps schema migration before comparing operation effects.
  const before = JSON.stringify(env.apps.rows[1]);
  assert.match(env.context.uiExtendHistory('com.example.app', '2026-10-01').message, /Nothing to import/);
  assert.match(env.context.uiExtendHistory('com.example.app', '2026-10-15').message, /only extends history/);
  assert.equal(JSON.stringify(env.apps.rows[1]), before);
  assert.deepEqual(ids(env), ['1']);
  assert.equal(env.requested.length, 0);
});

test('duplicate Add App with same or newer date creates no new app or sheet', () => {
  const env = setup({ reviews: [row(1, '2026-10-01')] });
  for (const date of ['2026-10-01', '2026-10-15']) {
    const result = env.context.uiAddApp({ appName: 'Example', packageName: 'com.example.app', importFromDate: date });
    assert.match(result.message, /already configured/);
  }
  assert.equal(env.apps.rows.length, 2);
  assert.deepEqual(ids(env), ['1']);
  assert.equal(env.requested.length, 0);
});

test('Add App identifier accepts direct package names and CafeBazaar link variants', () => {
  const env = setup();
  const inputs = [
    'com.samanpr.blu',
    '  com.samanpr.blu  ',
    'https://cafebazaar.ir/app/com.samanpr.blu',
    'https://cafebazaar.ir/app/com.samanpr.blu/',
    'https://cafebazaar.ir/app/com.samanpr.blu?l=en',
    'https://cafebazaar.ir/app/com.samanpr.blu#something',
    'https://www.cafebazaar.ir/app/com.samanpr.blu',
    '  https://cafebazaar.ir/app/com.samanpr.blu/?l=en#details  '
  ];
  for (const input of inputs) {
    assert.equal(env.context.cbrNormalizeAppIdentifier(input), 'com.samanpr.blu');
    const source = env.context.cbrNormalizeAppSource(input);
    assert.equal(source.store, 'cafebazaar');
    assert.equal(source.packageName, 'com.samanpr.blu');
    assert.equal(source.sourceUrl, 'https://cafebazaar.ir/app/com.samanpr.blu');
  }
});

test('Add App identifier rejects malformed or unsupported links and invalid packages', () => {
  const env = setup();
  assert.throws(() => env.context.cbrNormalizeAppIdentifier(''), /app link or package name/);
  assert.throws(() => env.context.cbrNormalizeAppIdentifier('https://cafebazaar.ir/app/'), /\/app\/</);
  assert.throws(() => env.context.cbrNormalizeAppIdentifier('https://cafebazaar.ir/other/com.samanpr.blu'), /\/app\/</);
  assert.throws(() => env.context.cbrNormalizeAppIdentifier('https://example.com/app/com.samanpr.blu'), /Only cafebazaar.ir/);
  assert.throws(() => env.context.cbrNormalizeAppIdentifier('https://cafebazaar.ir.evil.test/app/com.samanpr.blu'), /Only cafebazaar.ir/);
  assert.throws(() => env.context.cbrNormalizeAppIdentifier('https://cafebazaar.ir@app.example.test/app/com.samanpr.blu'), /Only cafebazaar.ir/);
  assert.throws(() => env.context.cbrNormalizeAppIdentifier('https://cafebazaar.ir/app/not-a-package'), /valid package name/);
  assert.throws(() => env.context.cbrNormalizeAppIdentifier('http://cafebazaar.ir/app/com.samanpr.blu'), /https:\/\//);
  assert.throws(() => env.context.cbrNormalizeAppIdentifier('https://cafebazaar.ir/app/com.samanpr.blu/extra'), /\/app\/</);
});

test('Add App uses normalized link package for metadata and history API request', () => {
  const env = setup();
  env.pages.set('', page([review(1, '2026/10/01')]));
  env.context.uiAddApp({
    appName: 'Blu', packageName: ' https://cafebazaar.ir/app/com.samanpr.blu?l=en ',
    importFromDate: '2026-10-01'
  });
  const added = env.context.cbrFindApp('com.samanpr.blu');
  assert.equal(added.package_name, 'com.samanpr.blu');
  assert.equal(added.store, 'cafebazaar');
  assert.equal(added.source_url, 'https://cafebazaar.ir/app/com.samanpr.blu');
  assert.equal(added.sheet_name, 'Blu - CafeBazaar');
  assert.equal(added.status, 'READY');
  assert.deepEqual(env.requested.map(item => item.pkg), ['com.samanpr.blu']);
  assert.equal(env.apps.rows.length, 3);
  assert.equal(env.context.uiGetApps().length, 2);
});

test('Add App validates its provider before creating a sheet or RUNNING row', () => {
  const env = setup();
  const sheetCount = env.context.SpreadsheetApp.getActive().getSheets().length;
  env.context.cbrGetReviewProvider = () => { throw new Error('Unsupported store: synthetic'); };
  assert.throws(() => env.context.uiAddApp({
    appName: 'Another', packageName: 'com.example.another', importFromDate: '2026-10-01'
  }), /Unsupported store: synthetic/);
  assert.equal(env.apps.rows.length, 2);
  assert.equal(env.context.SpreadsheetApp.getActive().getSheets().length, sheetCount);
});

test('new source sheet names are store-qualified and retain collision handling', () => {
  const env = setup();
  const first = env.context.cbrCreateReviewSheet('blu', 'cafebazaar');
  const second = env.context.cbrCreateReviewSheet('blu', 'cafebazaar');
  assert.equal(first.getName(), 'blu - CafeBazaar');
  assert.equal(second.getName(), 'blu - CafeBazaar 2');
  assert.equal(env.reviews.getName(), 'Example');
  assert.ok(env.context.cbrCreateReviewSheet('A'.repeat(100), 'cafebazaar').getName().length <= 100);
});

test('Apps identity is store plus package, while CafeBazaar remains the default lookup', () => {
  const env = setup({ schemaColumns: 18 });
  const myket = env.context.cbrInsertApp({
    package_name: 'com.example.app', store: 'myket', source_url: 'https://example.test/myket/com.example.app',
    app_name: 'Other source', sheet_id: 77, sheet_name: 'Other app', import_from_date: '2026-10-01', status: 'READY'
  });
  assert.equal(myket.store, 'myket');
  assert.equal(env.context.cbrFindApp('com.example.app').store, 'cafebazaar');
  assert.equal(env.context.cbrFindApp('com.example.app', 'myket').sheet_id, 77);
  assert.throws(() => env.context.cbrInsertApp({
    package_name: 'com.example.app', store: 'cafebazaar', import_from_date: '2026-10-01'
  }), /already exists in this store/);
  env.context.cbrUpdateApp('com.example.app', { app_name: 'Updated other source' }, 'myket');
  assert.equal(env.context.cbrFindApp('com.example.app', 'myket').app_name, 'Updated other source');
  assert.equal(env.context.cbrFindApp('com.example.app').app_name, 'Example');
});

test('unsupported or missing provider fails before operation metadata changes', () => {
  const env = setup();
  const app = appState(env);
  const before = env.apps.rows.map(row => Array.from(row));
  assert.throws(() => env.context.cbrStartHistory({ ...app, store: '' }), /Missing store/);
  assert.throws(() => env.context.cbrStartSync({ ...app, store: 'myket' }), /Unsupported store: myket/);
  assert.throws(() => env.context.cbrExtendHistory({ ...app, store: 'myket' }, '2026-09-01'), /Unsupported store: myket/);
  assert.throws(() => env.context.cbrContinue({ ...app, store: 'myket', operation_type: 'SYNC',
    operation_cursor: 'FAKE_SAVED_CURSOR', status: 'PAUSED' }), /Unsupported store: myket/);
  assert.deepEqual(env.apps.rows.map(row => Array.from(row)), before);
  assert.equal(env.requested.length, 0);
});

test('unsupported future store cards do not launch CafeBazaar operations', () => {
  const html = renderSidebarCard({
    app_name: 'Example', package_name: 'com.example.app', store: 'myket', store_label: 'Myket',
    sheet_id: 77, sheet_name: 'Example - Myket', import_from_date: '2026-10-01',
    coverage_from_date: '', coverage_to_date: '', status: 'READY', operation_type: '', last_sync_display: '—'
  });
  assert.match(html, /Myket · com\.example\.app/);
  assert.match(html, /This store is not supported yet/);
  assert.doesNotMatch(html, /Sync New Reviews|Extend History/);
});

test('Add App link to an existing package does not create a duplicate app', () => {
  const env = setup();
  const result = env.context.uiAddApp({
    appName: 'Example', packageName: 'https://cafebazaar.ir/app/com.example.app',
    importFromDate: '2026-10-01'
  });
  assert.match(result.message, /already configured/);
  assert.equal(env.apps.rows.length, 2);
  assert.equal(env.requested.length, 0);
});

test('Cancel Sync & Repair removes only older rows, accepts native dates, and preserves other app', () => {
  const env = setup({ appRows: [[
    'com.example.app', 'Example', 42, 'Example', new Date(2026, 9, 1), '2026-10-01', 'SYNC', 'saved-cursor', 'PAUSED', 'previous-sync', '', '', ''
  ]], reviews: [row(3, '2026-10-03'), row(2, new Date(2026, 9, 1)), row(1, new Date(2026, 8, 30))] });
  const otherBefore = JSON.stringify(env.other.rows);
  const result = env.context.uiCancelSyncAndRepair('com.example.app');
  assert.equal(result.rowsRemoved, 1);
  assert.equal(result.rowsPreserved, 2);
  assert.deepEqual(ids(env), ['3', '2']);
  assert.equal(appState(env).status, 'READY');
  assert.equal(appState(env).operation_type, '');
  assert.equal(appState(env).operation_cursor, '');
  assert.equal(appState(env).last_sync_at, 'previous-sync');
  assert.equal(JSON.stringify(env.other.rows), otherBefore);
});

test('repair rejects an app without a paused SYNC', () => {
  const env = setup({ reviews: [row(1, '2026-09-30')] });
  assert.throws(() => env.context.uiCancelSyncAndRepair('com.example.app'), /Only a paused SYNC/);
  assert.deepEqual(ids(env), ['1']);
});

test('paused sync resumes from saved cursor and obeys boundary', () => {
  const env = setup({ appRows: [[
    'com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-01', 'SYNC', 'saved-cursor', 'PAUSED', '', '', '', ''
  ]] });
  env.pages.set('saved-cursor', page([review(1, '2026/09/30')], 'later'));
  env.context.uiContinueOperation('com.example.app');
  assert.deepEqual(env.requested.map(item => item.cursor), ['saved-cursor']);
  assert.deepEqual(ids(env), []);
});

test('duplicate Add App with earlier date uses extension without creating another sheet or app', () => {
  const env = setup();
  env.pages.set('', page([review(1, '2026/09/01'), review(2, '2026/08/31')], 'later'));
  env.context.uiAddApp({ appName: 'Example', packageName: 'com.example.app', importFromDate: '2026-09-01' });
  assert.equal(env.apps.rows.length, 2);
  assert.equal(env.reviews.rows.length, 2);
  assert.equal(appState(env).import_from_date, '2026-09-01');
});

test('initial HISTORY coverage uses actual stored dates, not requested boundary', () => {
  const env = setup({ appRows: [[
    'com.example.app', 'Example', 42, 'Example', '2026-10-01', '', 'HISTORY', '', 'ERROR', '', '', '', ''
  ]] });
  env.pages.set('', page([review(1, '2026/10/06'), review(2, '2026/10/03'), review(3, '2026/09/30')], 'later'));
  env.context.uiContinueOperation('com.example.app');
  assert.equal(appState(env).import_from_date, '2026-10-01');
  assert.equal(appState(env).imported_until_date, '2026-10-03');
  assert.equal(appState(env).coverage_from_date, '2026-10-03');
  assert.equal(appState(env).coverage_to_date, '2026-10-06');
});

test('History writes the original CafeBazaar review payload into raw_json', () => {
  const env = setup({ appRows: [[
    'com.example.app', 'Example', 42, 'Example', '2026-10-01', '', 'HISTORY', '', 'ERROR', '', '', '', ''
  ]] });
  const raw = { ...review(1, '2026/10/04'), providerSpecific: { marker: 'synthetic' } };
  env.pages.set('', page([raw, review(2, '2026/09/30')], 'FAKE_NEXT_CURSOR'));
  env.context.uiContinueOperation('com.example.app');
  assert.equal(env.reviews.rows[1][14], JSON.stringify(raw));
  assert.equal(JSON.parse(env.reviews.rows[1][14]).date, '2026/10/04');
});

test('paused HISTORY persists coverage and resume extends it from native Date rows', () => {
  const env = setup({ appRows: [[
    'com.example.app', 'Example', 42, 'Example', '2026-10-01', '', 'HISTORY', '', 'ERROR', '', '', '', ''
  ]] });
  env.context.CBR_CONFIG = Object.freeze({ ...env.context.CBR_CONFIG, SOFT_DEADLINE_MS: -1 });
  env.pages.set('', page([review(1, '2026/10/06')], 'resume'));
  env.pages.set('resume', page([review(2, new Date(2026, 9, 3)), review(3, '2026/09/30')], 'later'));
  assert.equal(env.context.uiContinueOperation('com.example.app').paused, true);
  assert.equal(appState(env).coverage_from_date, '2026-10-06');
  assert.equal(appState(env).coverage_to_date, '2026-10-06');
  env.context.uiContinueOperation('com.example.app');
  assert.equal(appState(env).coverage_from_date, '2026-10-03');
  assert.equal(appState(env).coverage_to_date, '2026-10-06');
  assert.deepEqual(env.requested.map(item => item.cursor), ['', 'resume']);
});

test('SYNC maintains coverage for new and updated dates and never counts older reviews', () => {
  const env = setup({ reviews: [row(1, '2026-10-01'), row(2, '2026-10-04')] });
  env.pages.set('', page([
    review(3, '2026/10/07'), review(1, '2026/10/03', 'date edited'), review(4, '2026/09/30')
  ], 'later'));
  env.context.uiSyncNewReviews('com.example.app');
  assert.equal(appState(env).coverage_from_date, '2026-10-03');
  assert.equal(appState(env).coverage_to_date, '2026-10-07');
  assert.equal(appState(env).imported_until_date, '2026-10-01');
  assert.deepEqual(ids(env).sort(), ['1', '2', '3']);
});

test('paused SYNC persists coverage and resumes from the exact cursor', () => {
  const env = setup({ reviews: [row(1, '2026-10-02')] });
  env.context.CBR_CONFIG = Object.freeze({ ...env.context.CBR_CONFIG, SOFT_DEADLINE_MS: -1 });
  env.pages.set('', page([review(2, '2026/10/07')], 'resume-sync'));
  env.pages.set('resume-sync', page([review(1, '2026/10/02')], 'later'));
  assert.equal(env.context.uiSyncNewReviews('com.example.app').paused, true);
  assert.equal(appState(env).coverage_from_date, '2026-10-02');
  assert.equal(appState(env).coverage_to_date, '2026-10-07');
  env.context.uiContinueOperation('com.example.app');
  assert.equal(appState(env).status, 'READY');
  assert.equal(appState(env).coverage_to_date, '2026-10-07');
  assert.deepEqual(env.requested.map(item => item.cursor), ['', 'resume-sync']);
});

test('Extend History adds actual older coverage while preserving newest date', () => {
  const env = setup({ schemaColumns: 14, appRows: [[
    'com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-01', '', '', 'READY', '', '', '', '', 'old-anchor'
  ]], reviews: [row(1, '2026-10-01'), row(2, '2026-10-07')] });
  env.pages.set('old-anchor', page([review(1, '2026/10/01'), review(3, '2026/09/20'), review(4, '2026/09/19')], 'later'));
  env.context.uiExtendHistory('com.example.app', '2026-09-20');
  assert.equal(appState(env).coverage_from_date, '2026-09-20');
  assert.equal(appState(env).coverage_to_date, '2026-10-07');
  assert.equal(appState(env).imported_until_date, '2026-09-20');
  assert.deepEqual(ids(env).sort(), ['1', '2', '3']);
});

test('repair computes coverage from preserved rows and clears it when none remain', () => {
  const paused = ['com.example.app', 'Example', 42, 'Example', '2026-10-01', '2026-10-01',
    'SYNC', 'cursor', 'PAUSED', '', '', '', ''];
  const env = setup({ appRows: [paused], reviews: [
    row(1, new Date(2026, 8, 30)), row(2, new Date(2026, 9, 1)), row(3, '2026-10-06')
  ] });
  env.context.uiCancelSyncAndRepair('com.example.app');
  assert.equal(appState(env).coverage_from_date, '2026-10-01');
  assert.equal(appState(env).coverage_to_date, '2026-10-06');
  assert.equal(appState(env).imported_until_date, '2026-10-01');
  const empty = setup({ appRows: [paused], reviews: [row(1, '2026-09-30')] });
  empty.context.uiCancelSyncAndRepair('com.example.app');
  assert.equal(appState(empty).coverage_from_date, '');
  assert.equal(appState(empty).coverage_to_date, '');
});

test('operation error reconciles coverage after a partial review write', () => {
  const env = setup({ appRows: [[
    'com.example.app', 'Example', 42, 'Example', '2026-10-01', '', 'HISTORY', '', 'ERROR', '', '', '', ''
  ]] });
  env.pages.set('', page([review(1, '2026/10/05')]));
  const upsert = env.context.cbrUpsertReviews;
  env.context.cbrUpsertReviews = function(sheet, reviews, state, fetchedAt) {
    upsert(sheet, reviews, state, fetchedAt);
    throw Error('Simulated write interruption');
  };
  assert.throws(() => env.context.uiContinueOperation('com.example.app'), /Simulated write interruption/);
  assert.equal(appState(env).status, 'ERROR');
  assert.equal(appState(env).operation_type, 'HISTORY');
  assert.equal(appState(env).coverage_from_date, '2026-10-05');
  assert.equal(appState(env).coverage_to_date, '2026-10-05');
  env.context.cbrUpsertReviews = upsert;
  env.context.uiContinueOperation('com.example.app');
  assert.equal(appState(env).status, 'READY');
  assert.deepEqual(ids(env), ['1']);
  assert.equal(appState(env).coverage_from_date, '2026-10-05');
});
