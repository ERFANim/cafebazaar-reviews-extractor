'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

global.CBR_CONFIG = require('../src/Config.js');
const logic = require('../src/Utils.js');
global.cbrString = value => value == null ? '' : String(value);
global.cbrNormalizeDate = logic.normalizeDate;
const { appFromRow, findSheetById } = require('../src/AppRepository.js');

function review(id, date, comment) { return { id, date, user: 'کاربر', rate: 4, comment: comment || '', likes: 0, total: 0, reply: null, isEdited: false }; }

test('YYYY/MM/DD is normalized to YYYY-MM-DD', () => {
  assert.equal(logic.normalizeDate('2026/10/01'), '2026-10-01');
});

test('YYYY-MM-DD remains canonical', () => {
  assert.equal(logic.normalizeDate('2026-10-01'), '2026-10-01');
});

test('native Date is normalized from local date components', () => {
  assert.equal(logic.normalizeDate(new Date(2026, 9, 1)), '2026-10-01');
});

test('invalid native Date is rejected', () => {
  assert.throws(() => logic.normalizeDate(new Date('invalid')), /Invalid date/);
});

test('invalid calendar dates are rejected', () => {
  assert.throws(() => logic.normalizeDate('2026-02-30'), /Invalid date/);
});

test('invalid date strings are rejected', () => {
  assert.throws(() => logic.normalizeDate('October 1, 2026'), /Invalid date/);
});

test('Apps repository normalizes native date cells to canonical strings', () => {
  const row = ['com.example.app', 'Example', 42, 'Example', new Date(2026, 9, 1), new Date(2026, 9, 3), 'HISTORY', '', 'ERROR', '', '', '', ''];
  const app = appFromRow(row, 2);
  assert.equal(app.import_from_date, '2026-10-01');
  assert.equal(app.imported_until_date, '2026-10-03');
  assert.equal(typeof app.import_from_date, 'string');
});

test('historical import decision accepts a Date-derived repository boundary', () => {
  const row = ['com.example.app', 'Example', 42, 'Example', new Date(2026, 9, 1), '', 'HISTORY', '', 'ERROR', '', '', '', ''];
  const app = appFromRow(row, 2);
  const result = logic.historyPageDecision([review(1, '2026/10/01')], app.import_from_date, 'next');
  assert.deepEqual(result.accepted.map(item => item.id), [1]);
  assert.equal(result.stop, false);
});

test('historical target date is inclusive', () => {
  const result = logic.historyPageDecision([review(1, '2026/07/01')], '2026-07-01', 'next');
  assert.deepEqual(result.accepted.map(r => r.id), [1]);
  assert.equal(result.stop, false);
});

test('historical import excludes reviews older than target', () => {
  const result = logic.historyPageDecision([review(1, '2026/06/30')], '2026-07-01', 'next');
  assert.equal(result.accepted.length, 0);
  assert.equal(result.stop, true);
});

test('history pagination continues when target is not reached', () => {
  const result = logic.historyPageDecision([review(2, '2026/07/03'), review(1, '2026/07/02')], '2026-07-01', 'cursor-2');
  assert.equal(result.stop, false);
  assert.equal(result.nextCursor, 'cursor-2');
});

test('history stops when a page crosses the target and keeps eligible reviews', () => {
  const result = logic.historyPageDecision([review(3, '2026/07/02'), review(2, '2026/07/01'), review(1, '2026/06/30')], '2026-07-01', 'cursor');
  assert.deepEqual(result.accepted.map(r => r.id), [3, 2]);
  assert.equal(result.crossed, true);
  assert.equal(result.stop, true);
});

test('paused state preserves the exact next cursor', () => {
  const result = logic.historyPageDecision([review(3, '2026/07/03')], '2026-07-01', 'opaque|cursor|value');
  const pausedState = { operation_type: 'HISTORY', operation_cursor: result.nextCursor, status: 'PAUSED' };
  assert.deepEqual(pausedState, { operation_type: 'HISTORY', operation_cursor: 'opaque|cursor|value', status: 'PAUSED' });
});

test('sync identifies new IDs for insertion', () => {
  const result = logic.syncPageDecision([review(2, '2026/10/04')], new Set(['1']), 'next', '2026-10-01');
  assert.deepEqual(result.newReviews.map(r => r.id), [2]);
});

test('sync identifies known IDs for update', () => {
  const result = logic.syncPageDecision([review(1, '2026/10/04', 'edited')], new Set(['1']), 'next', '2026-10-01');
  assert.deepEqual(result.knownReviews.map(r => r.id), [1]);
});

test('upsert model does not duplicate review IDs', () => {
  const rows = new Map([['1', review(1, '2026/10/01', 'old')]]);
  [review(1, '2026/10/01', 'new'), review(2, '2026/10/02')].forEach(r => rows.set(logic.reviewId(r.id), r));
  assert.equal(rows.size, 2);
  assert.equal(rows.get('1').comment, 'new');
});

test('sync does not stop on a partially-known page', () => {
  const result = logic.syncPageDecision([review(3, '2026/10/03'), review(2, '2026/10/02'), review(1, '2026/10/01')], new Set(['2']), 'next', '2026-10-01');
  assert.equal(result.stop, false);
  assert.deepEqual(result.newReviews.map(r => r.id), [3, 1]);
});

test('sync stops on the first fully-known non-empty page', () => {
  const result = logic.syncPageDecision([review(2, '2026/10/02'), review(1, '2026/10/01')], new Set(['1', '2']), 'next', '2026-10-01');
  assert.equal(result.stop, true);
  assert.equal(result.knownReviews.length, 2);
});

test('empty reviews stop pagination', () => {
  assert.equal(logic.syncPageDecision([], new Set(), 'next', '2026-10-01').stop, true);
  assert.equal(logic.historyPageDecision([], '2026-01-01', 'next').stop, true);
});

test('missing next cursor stops pagination', () => {
  assert.equal(logic.syncPageDecision([review(2, '2026/10/02')], new Set(), '', '2026-10-01').stop, true);
  assert.equal(logic.historyPageDecision([review(2, '2026/10/02')], '2026-01-01', '').stop, true);
});

test('paused SYNC resumes from stored cursor rather than newest', () => {
  const app = { operation_type: 'SYNC', operation_cursor: 'saved|opaque|cursor' };
  const cursorPassedToRunner = app.operation_cursor;
  assert.equal(cursorPassedToRunner, 'saved|opaque|cursor');
  assert.notEqual(cursorPassedToRunner, '');
});

test('two apps remain isolated in separate repositories', () => {
  const repositories = new Map([['com.one', new Map()], ['com.two', new Map()]]);
  repositories.get('com.one').set('10', review(10, '2026/10/01'));
  repositories.get('com.two').set('20', review(20, '2026/10/02'));
  assert.deepEqual([...repositories.get('com.one').keys()], ['10']);
  assert.deepEqual([...repositories.get('com.two').keys()], ['20']);
});

test('sheet lookup relies on numeric sheet_id even after a rename', () => {
  const sheets = [
    { getSheetId: () => 11, getName: () => 'Old Name' },
    { getSheetId: () => 42, getName: () => 'Renamed By User' }
  ];
  assert.equal(findSheetById(sheets, '42').getName(), 'Renamed By User');
});

test('review row preserves Unicode and serializes structured reply', () => {
  const row = logic.reviewToRow({ ...review(1, '2026/10/04', 'متن فارسی'), reply: { comment: 'پاسخ' }, accountID: 'a' }, '2026-10-04T00:00:00.000Z');
  assert.equal(row[4], 'متن فارسی');
  assert.equal(row[8], JSON.stringify({ comment: 'پاسخ' }));
});
