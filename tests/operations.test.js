'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const files = [
  'Config.js', 'Utils.js', 'AppRepository.js', 'ReviewRepository.js',
  'HistoryImportService.js', 'SyncService.js', 'OperationService.js', 'Code.js'
];

class Sheet {
  constructor(name, id, rows) { this.name = name; this.id = id; this.rows = rows.map(row => [...row]); }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return Math.max(0, ...this.rows.map(row => row.length)); }
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
      sort() { sheet.rows.splice(row - 1, height, ...sheet.rows.slice(row - 1, row - 1 + height).sort((a, b) => String(b[1]).localeCompare(String(a[1])))); }
    };
  }
  deleteRows(start, count) { this.rows.splice(start - 1, count); }
  setFrozenRows() {}
  setColumnWidth() {}
  autoResizeColumns() {}
}

function setup(options = {}) {
  const config = require('../src/Config.js');
  const oldHeaders = config.APPS_HEADERS.slice(0, -1);
  const appRows = options.appRows || [[
    'com.example.app', 'Example', 42, 'Example', new Date(2026, 9, 1),
    '2026-10-01', '', '', 'READY', 'previous-sync', '', 'created', 'updated'
  ]];
  const apps = new Sheet('Apps', 1, [options.oldSchema === false ? [...config.APPS_HEADERS] : [...oldHeaders], ...appRows]);
  const reviews = new Sheet('Example', 42, [[...config.REVIEW_HEADERS], ...(options.reviews || [])]);
  const other = new Sheet('Other app', 77, [[...config.REVIEW_HEADERS], ['999', '2026-09-01']]);
  const sheets = [apps, reviews, other];
  const spreadsheet = {
    getSheetByName(name) { return sheets.find(sheet => sheet.name === name) || null; },
    getSheets() { return sheets; }
  };
  const context = vm.createContext({
    SpreadsheetApp: { getActive: () => spreadsheet },
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

test('Apps schema migration appends anchor column without changing existing rows', () => {
  const env = setup();
  const before = env.apps.rows[1].slice();
  const found = appState(env);
  assert.equal(env.apps.rows[0][13], 'history_anchor_cursor');
  assert.deepEqual(env.apps.rows[1].slice(0, 13), before);
  assert.equal(found.import_from_date, '2026-10-01');
  assert.equal(found.history_anchor_cursor, '');
});

test('schema migration preserves two separate app records', () => {
  const first = ['com.example.app', 'Example', 42, 'Example', new Date(2026, 9, 1), '2026-10-01', '', '', 'READY', '', '', '', ''];
  const second = ['com.other.app', 'Other app', 77, 'Other app', '2026-09-01', '2026-09-01', '', '', 'READY', '', '', '', ''];
  const env = setup({ appRows: [first, second] });
  const apps = env.context.cbrListApps();
  assert.equal(apps.length, 2);
  assert.deepEqual(apps.map(app => app.sheet_id), [42, 77]);
  assert.deepEqual(env.apps.rows[2].slice(0, 13), second);
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
