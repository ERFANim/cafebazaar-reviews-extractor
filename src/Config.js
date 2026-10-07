var CBR_CONFIG = Object.freeze({
  APPS_SHEET_NAME: 'Apps',
  APPS_HEADERS: Object.freeze([
    'package_name', 'app_name', 'sheet_id', 'sheet_name', 'import_from_date',
    'imported_until_date', 'operation_type', 'operation_cursor', 'status',
    'last_sync_at', 'last_error', 'created_at', 'updated_at',
    'history_anchor_cursor', 'coverage_from_date', 'coverage_to_date',
    'store', 'source_url'
  ]),
  REVIEW_HEADERS: Object.freeze([
    'review_id', 'date', 'user', 'rate', 'comment', 'version_code', 'likes',
    'total', 'reply', 'is_edited', 'account_id', 'avatar_url',
    'user_replies_count', 'fetched_at', 'raw_json'
  ]),
  STATUS: Object.freeze({ READY: 'READY', RUNNING: 'RUNNING', PAUSED: 'PAUSED', ERROR: 'ERROR' }),
  OPERATION: Object.freeze({ HISTORY: 'HISTORY', SYNC: 'SYNC' }),
  STORE: Object.freeze({ CAFEBAZAAR: 'cafebazaar' }),
  CAFEBAZAAR_APP_URL_PREFIX: 'https://cafebazaar.ir/app/',
  SOFT_DEADLINE_MS: 4 * 60 * 1000,
  LOCK_WAIT_MS: 5000,
  MAX_CELL_CHARS: 49000
});

if (typeof module !== 'undefined') module.exports = CBR_CONFIG;
