'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sourceFiles = [
  'Config.js', 'Utils.js', 'CafeBazaarApi.js', 'CafeBazaarProvider.js', 'ProviderRegistry.js'
];
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

function setup(responses) {
  const requested = [];
  const sleeps = [];
  const queue = responses.slice();
  const context = vm.createContext({
    UrlFetchApp: {
      fetch(url, options) {
        requested.push({ url, options });
        if (!queue.length) throw new Error('No mock API response available.');
        const response = queue.shift();
        return {
          getResponseCode: () => response.code,
          getContentText: () => response.text
        };
      }
    },
    Utilities: { sleep: milliseconds => sleeps.push(milliseconds) }
  });
  for (const file of sourceFiles) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context, { filename: file });
  }
  return { context, requested, sleeps };
}

test('provider registry resolves only the canonical CafeBazaar store', () => {
  const { context } = setup([]);
  assert.equal(typeof context.cbrGetReviewProvider('cafebazaar').fetchReviewPage, 'function');
  for (const missing of [undefined, null, '', '   ']) {
    assert.throws(() => context.cbrGetReviewProvider(missing), /Missing store/);
  }
  for (const unsupported of ['myket', 'sibapp', 'CafeBazaar', ' cafebazaar ']) {
    assert.throws(() => context.cbrGetReviewProvider(unsupported), /Unsupported store/);
  }
});

test('CafeBazaar provider preserves the POST request and opaque cursor exactly', () => {
  const cursor = '  FAKE|OPAQUE/+=?CURSOR  ';
  const nextCursor = '  FAKE_NEXT|OPAQUE/+=?CURSOR  ';
  const payload = JSON.parse(fixture('success-page.json'));
  payload.singleReply.reviewReply.nextPageCursor = nextCursor;
  const { context, requested } = setup([{ code: 200, text: JSON.stringify(payload) }]);
  const page = context.cbrGetReviewProvider('cafebazaar')
    .fetchReviewPage({ store: 'cafebazaar', package_name: 'com.example.app' }, cursor);

  assert.equal(requested.length, 1);
  assert.equal(requested[0].url, 'https://api.cafebazaar.ir/rest-v1/process/ReviewRequest');
  assert.equal(requested[0].options.method, 'post');
  assert.equal(requested[0].options.contentType, 'application/json');
  assert.equal(requested[0].options.muteHttpExceptions, true);
  assert.equal(JSON.parse(requested[0].options.payload).singleRequest.reviewRequest.packageName, 'com.example.app');
  assert.equal(JSON.parse(requested[0].options.payload).singleRequest.reviewRequest.cursor, cursor);
  assert.equal(JSON.parse(requested[0].options.payload).singleRequest.reviewRequest.sortBy, 1);
  assert.equal(page.nextCursor, nextCursor);
  assert.equal(page.reviews.length, 2);
});

test('normalized review has all stored fields and raw_json keeps the original payload', () => {
  const raw = {
    id: 123456, date: '2026/10/04', user: 'Sample User', rate: 5,
    comment: 'Sample review', versionCode: 7, likes: 2, total: 3,
    reply: { comment: 'Sample reply' }, isEdited: true,
    accountID: 'fake-account-id', avatarURL: 'https://example.test/avatar.png',
    userRepliesCount: 1, providerSpecific: { marker: 'synthetic extra field' }
  };
  const response = { properties: { statusCode: 200, errorMessage: '' },
    singleReply: { reviewReply: { reviews: [raw], nextPageCursor: '' } } };
  const { context } = setup([{ code: 200, text: JSON.stringify(response) }]);
  const normalized = context.cbrGetReviewProvider('cafebazaar')
    .fetchReviewPage({ package_name: 'com.example.app' }, '').reviews[0];
  for (const field of ['id', 'user', 'rate', 'comment', 'versionCode', 'likes', 'total',
    'reply', 'isEdited', 'accountID', 'avatarURL', 'userRepliesCount']) {
    assert.deepEqual(JSON.parse(JSON.stringify(normalized[field])), raw[field]);
  }
  assert.equal(normalized.date, '2026-10-04');
  const row = context.cbrReviewToRow(normalized, '2026-10-07T00:00:00.000Z');
  assert.equal(row[1], '2026-10-04');
  assert.equal(row[14], JSON.stringify(raw));
  assert.equal(JSON.parse(row[14]).date, '2026/10/04');
  assert.equal(JSON.parse(row[14]).providerSpecific.marker, 'synthetic extra field');
});

test('original raw payload still receives the existing safe cell-length truncation', () => {
  const { context } = setup([]);
  const raw = { id: 1, date: '2026/10/04', comment: 'x'.repeat(50000) };
  const normalized = context.cbrNormalizeCafeBazaarReview(raw);
  const row = context.cbrReviewToRow(normalized, '2026-10-07T00:00:00.000Z');
  assert.ok(row[14].length <= context.CBR_CONFIG.MAX_CELL_CHARS);
  assert.match(row[14], /\.\.\.\[truncated\]$/);
});

test('provider preserves malformed JSON, HTTP, and logical API errors', () => {
  const app = { package_name: 'com.example.app' };
  const malformed = setup([{ code: 200, text: 'not-json' }]);
  assert.throws(() => malformed.context.cbrGetReviewProvider('cafebazaar').fetchReviewPage(app, ''), /malformed JSON/);
  const http = setup([{ code: 400, text: '{}' }]);
  assert.throws(() => http.context.cbrGetReviewProvider('cafebazaar').fetchReviewPage(app, ''), /CafeBazaar HTTP 400/);
  const logical = setup([{ code: 200, text: fixture('logical-error.json') }]);
  assert.throws(() => logical.context.cbrGetReviewProvider('cafebazaar').fetchReviewPage(app, ''), /CafeBazaar status 400/);
});

test('transient HTTP retry remains bounded inside the CafeBazaar transport', () => {
  const success = fixture('success-page.json');
  const { context, requested, sleeps } = setup([
    { code: 429, text: '{}' }, { code: 503, text: '{}' }, { code: 200, text: success }
  ]);
  const page = context.cbrGetReviewProvider('cafebazaar')
    .fetchReviewPage({ package_name: 'com.example.app' }, 'FAKE_CURSOR');
  assert.equal(page.reviews.length, 2);
  assert.equal(requested.length, 3);
  assert.deepEqual(sleeps, [500, 1000]);
  assert.ok(requested.every(request => JSON.parse(request.options.payload).singleRequest.reviewRequest.cursor === 'FAKE_CURSOR'));
});
