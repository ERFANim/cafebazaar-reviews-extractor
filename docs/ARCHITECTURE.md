# Architecture

CafeBazaar Reviews Extractor is a Google Apps Script V8 project bound to one Google Spreadsheet. `onOpen()` adds a menu that opens `Sidebar.html`. The sidebar calls a small server API in `Code.js` through `google.script.run`. `CafeBazaarApi.js` sends JSON POST requests with `UrlFetchApp.fetch`; repositories write metadata and review rows to the bound spreadsheet. No backend, database, or scheduled trigger is used.

## Sheets and metadata

The `Apps` tab has one row per unique `package_name`. Its columns, in order, are:

`package_name`, `app_name`, `sheet_id`, `sheet_name`, `import_from_date`, `imported_until_date`, `operation_type`, `operation_cursor`, `status`, `last_sync_at`, `last_error`, `created_at`, `updated_at`, `history_anchor_cursor`.

`import_from_date` is the requested inclusive oldest date; `imported_until_date` records the oldest date actually imported during history work. `sheet_id` is used to locate a review tab even if someone renames it; `sheet_name` is updated when practical. Existing 13-column `Apps` tabs receive `history_anchor_cursor` as a new final column in place.

Each app has its own review tab, keyed by `review_id`. This keeps package data separate and allows review IDs to be unique within their own app. The columns are:

`review_id`, `date`, `user`, `rate`, `comment`, `version_code`, `likes`, `total`, `reply`, `is_edited`, `account_id`, `avatar_url`, `user_replies_count`, `fetched_at`, `raw_json`.

The header is frozen. Review dates are normalized to `YYYY-MM-DD`, and rows are sorted newest first after completed or paused chunks. Structured replies are stored as JSON; null replies are blank. `raw_json` is truncated if it would exceed the configured safe cell length.

## API and pagination

Every request uses `sortBy: 1` (Newest), a package name, and an opaque cursor. A new import or sync starts with `cursor: ""`; subsequent pages use the returned `nextPageCursor` unchanged. Both HTTP status and `properties.statusCode` are checked. HTTP 429 and 5xx responses receive a small bounded retry. See [API example](API_EXAMPLE.md).

CafeBazaar `YYYY/MM/DD` dates, ISO date strings, and valid native `Date` values read from Sheets are normalized to `YYYY-MM-DD` before comparisons. Native Dates use local calendar components so date-only values are not shifted by UTC conversion.

## Operations

- **Initial History Import:** Fetches newest-first pages, upserting reviews on or after the requested date. A page that crosses the boundary is processed for eligible rows, then history completes.
- **Sync New Reviews:** Starts at the newest page. Each page upserts only reviews on or after `import_from_date`. It stops after a page containing older reviews, a fully known nonempty page, an empty page, or the end of pagination. Known IDs are determined before writing each page; a partially known page continues.
- **Extend History:** A READY app can request an earlier `import_from_date`. History starts from `history_anchor_cursor` when available and re-fetches the old boundary page, safely upserting existing rows and adding the previously skipped older rows. If the anchor is blank, it starts from newest. Same or newer requested dates do not narrow or delete coverage.
- **Cancel Sync & Repair:** Available for a PAUSED SYNC. After sidebar confirmation, it scans that app's review tab, keeps rows on or after `import_from_date`, removes older rows in bulk, sorts the result, clears operation state, and leaves `last_sync_at` unchanged.

`history_anchor_cursor` is the cursor **used to fetch** the last completed history boundary page. `operation_cursor` is the **next** cursor saved after a processed page for the current resumable HISTORY or SYNC operation. Keeping them separate lets extension re-fetch a mixed boundary page without skipping reviews.

`operation_type` is `HISTORY`, `SYNC`, or blank. Status is `RUNNING`, `PAUSED`, `READY`, or `ERROR`. Completed operations clear `operation_type` and `operation_cursor`; a soft pause retains both. Errors record a concise `last_error` without discarding the last valid cursor, so Retry can resume. Each mutating UI operation holds a document lock to prevent simultaneous writes.

The soft deadline is configured at approximately four minutes. After each processed page, the next cursor and progress are saved; an approaching deadline returns a PAUSED result for a user-initiated Continue. There are no background triggers.
