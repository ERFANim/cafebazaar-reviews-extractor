'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

global.CBR_CONFIG = require('../src/Config.js');
global.cbrString = value => value == null ? '' : String(value);
const api = require('../src/CafeBazaarApi.js');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('request body always contains sortBy = 1', () => {
  assert.equal(api.buildRequestBody('com.example.app', 'abc').singleRequest.reviewRequest.sortBy, 1);
});

test('request body uses exact packageName and cursor', () => {
  const request = api.buildRequestBody('com.example.app', 'FAKE_OPAQUE_CURSOR');
  assert.equal(request.singleRequest.reviewRequest.packageName, 'com.example.app');
  assert.equal(request.singleRequest.reviewRequest.cursor, 'FAKE_OPAQUE_CURSOR');
});

test('successful response parsing preserves reviews and cursor', () => {
  const result = api.parseApiResponse(200, fixture('success-page.json'));
  assert.equal(result.reviews.length, 2);
  assert.equal(result.reviews[0].comment, 'Sample review');
  assert.equal(result.nextPageCursor, 'FAKE_NEXT_PAGE_CURSOR');
});

test('API logical error is reported', () => {
  assert.throws(() => api.parseApiResponse(200, fixture('logical-error.json')), /status 400: Invalid package/);
});

test('HTTP and malformed JSON errors are reported', () => {
  assert.throws(() => api.parseApiResponse(503, '{}'), /HTTP 503/);
  assert.throws(() => api.parseApiResponse(200, 'not-json'), /malformed JSON/);
});

test('missing reviewReply and reviews array are rejected', () => {
  assert.throws(() => api.parseApiResponse(200, JSON.stringify({ properties: { statusCode: 200 }, singleReply: {} })), /missing reviewReply/);
  assert.throws(() => api.parseApiResponse(200, JSON.stringify({ properties: { statusCode: 200 }, singleReply: { reviewReply: {} } })), /missing reviews array/);
});
