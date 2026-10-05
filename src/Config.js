var CBR_CONFIG = Object.freeze({
  API_URL: 'https://api.cafebazaar.ir/rest-v1/process/ReviewRequest',
  APPS_SHEET_NAME: 'Apps',
  APPS_HEADERS: Object.freeze([
    'package_name', 'app_name', 'sheet_id', 'sheet_name', 'import_from_date',
    'imported_until_date', 'operation_type', 'operation_cursor', 'status',
    'last_sync_at', 'last_error', 'created_at', 'updated_at',
    'history_anchor_cursor'
  ]),
  REVIEW_HEADERS: Object.freeze([
    'review_id', 'date', 'user', 'rate', 'comment', 'version_code', 'likes',
    'total', 'reply', 'is_edited', 'account_id', 'avatar_url',
    'user_replies_count', 'fetched_at', 'raw_json'
  ]),
  STATUS: Object.freeze({ READY: 'READY', RUNNING: 'RUNNING', PAUSED: 'PAUSED', ERROR: 'ERROR' }),
  OPERATION: Object.freeze({ HISTORY: 'HISTORY', SYNC: 'SYNC' }),
  SORT_BY: 1,
  SOFT_DEADLINE_MS: 4 * 60 * 1000,
  LOCK_WAIT_MS: 5000,
  FETCH_RETRIES: 2,
  RETRY_BASE_MS: 500,
  MAX_CELL_CHARS: 49000
});

if (typeof module !== 'undefined') module.exports = CBR_CONFIG;
