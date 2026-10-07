# CafeBazaar Reviews Extractor

A bound Google Apps Script tool that imports and syncs marketplace app reviews into Google Sheets. CafeBazaar is the only implemented store provider; the internal design can accommodate others later, but Myket and SibApp do not work yet.

## Features

- Manage multiple app/store sources in one spreadsheet, each with its own review tab.
- Add a CafeBazaar app by App Link and import reviews from a chosen inclusive date.
- Sync new reviews, extend history to an earlier date, and resume long operations from saved cursors.
- Retry failed operations or cancel and repair a paused sync.
- Upsert by review ID, prevent duplicates, and track the actual oldest and newest stored review dates.
- Keep the operational `Apps` registry internal; route review fetching through a store provider.
- Preserve Persian and other Unicode review text.

## Quick Install

1. [Open the Google Sheets template](https://docs.google.com/spreadsheets/d/1ansHE0xvCujTP1WTt3J9HjYyPNmYfV4s8I9_xRSTo44/copy) and make your own copy. Work in your copy, not the public template.
2. Open or reload the copied spreadsheet and choose **CafeBazaar Reviews → Open Panel**.
3. Authorize the script when Google prompts you.

Each copied spreadsheet contains its own bound Apps Script. Existing copies do not automatically receive future template updates.

## Quick Usage

### Add App

Enter an **App Name**, **App Link**, and **Import From Date**, then click **Add & Import**. For example, use `https://cafebazaar.ir/app/com.samanpr.blu`. Direct package-name input still works for backward compatibility. The selected date is inclusive.

### Sync New Reviews

Click **Sync New Reviews** on a ready app to fetch recent reviews and refresh stored reviews. Sync never imports reviews older than the configured date.

### Extend History

Choose an earlier date on the app card and click **Extend History** to import the missing older range. Choosing the same or a newer date does not delete existing data.

### Paused operations and errors

Use **Continue Import** or **Continue Sync** to resume a paused operation. Read an error on the app card and use **Retry** after addressing its cause. **Cancel Sync & Repair** is available for a paused sync: after confirmation, it cancels that sync and removes only reviews older than the configured date.

The spreadsheet's `README` tab provides a shorter end-user guide. It is created, if missing, when **Open Panel** runs; an existing `README` tab is left alone.

## How It Works

```text
Google Sheet
   ↓
Sidebar / Code.js
   ↓
OperationService
   ↓
ProviderRegistry
   ↓
CafeBazaarProvider
   ↓
CafeBazaarApi
   ↓
CafeBazaar Review API
```

`AppRepository` manages internal source state; `ReviewRepository` manages review rows, upserts, repair, and coverage. Core History and Sync services consume provider-normalized pages rather than CafeBazaar response structures. There is no external backend or scheduled trigger.

## Source / Store Model

One `Apps` row represents one app listing in one store. Source identity is `store + package_name`; `store` is currently `cafebazaar`, and `source_url` is the canonical listing URL. A direct package name or a CafeBazaar URL is stored as a canonical URL such as `https://cafebazaar.ir/app/com.example.app`.

Each source has a separate raw-review tab. New tabs use a store-qualified name, for example `blu - CafeBazaar`; existing tabs are not automatically renamed. Tabs are located by their numeric `sheet_id`, so user renames do not break the mapping.

```text
blu
├── CafeBazaar → blu - CafeBazaar
└── Myket      → future; not implemented
```

## Internal Apps Registry

`Apps` is operational state, not a user-editable data table. It is hidden when another visible tab exists and has a note and warning-based protection against accidental edits. The application reads it by name even while hidden. Its columns, in exact order, are:

```text
package_name, app_name, sheet_id, sheet_name, import_from_date,
imported_until_date, operation_type, operation_cursor, status,
last_sync_at, last_error, created_at, updated_at, history_anchor_cursor,
coverage_from_date, coverage_to_date, store, source_url
```

| Field | Meaning |
| --- | --- |
| `import_from_date` | Configured inclusive lower date boundary. |
| `imported_until_date` | Oldest date reached as HISTORY progress; **not** the newest imported review date. |
| `coverage_from_date` / `coverage_to_date` | Actual oldest/newest dates among stored reviews; blank if the review tab is empty. These drive the user-facing imported range. |
| `operation_type` / `operation_cursor` | Current resumable `HISTORY` or `SYNC` and the *next* cursor to fetch. |
| `history_anchor_cursor` | Cursor *used to fetch* the last completed history boundary page, so an extension can re-fetch that page. |
| `store` / `source_url` | Canonical store key and listing URL; currently `cafebazaar` and its normalized app URL. |

Statuses are `READY`, `RUNNING`, `PAUSED`, or `ERROR`. Existing Apps sheets are migrated by appending missing columns and backfilling source and coverage metadata without replacing review tabs. Do not edit this sheet manually, especially its headers, status, or cursors.

## Review Sheet Schema

Each source's review tab has these columns, in exact order:

```text
review_id, date, user, rate, comment, version_code, likes, total,
reply, is_edited, account_id, avatar_url, user_replies_count,
fetched_at, raw_json
```

`review_id` is the per-source upsert key. Review dates are normalized to `YYYY-MM-DD`; `fetched_at` records when a row was last fetched. `raw_json` serializes the **original provider review object**, including provider-specific fields, subject to safe truncation for the Google Sheets cell-size limit. Review rows are sorted newest-first after completed or paused chunks.

## Import and Sync Semantics

### Initial History Import

Starts at the newest CafeBazaar page with an empty cursor, moves backward, and upserts only reviews dated on or after `import_from_date`. It processes eligible reviews on a page crossing the inclusive boundary, then stops. Review IDs are not used as chronological boundaries.

### Sync New Reviews

Also starts from newest. It inserts and updates only reviews within the configured date range. A partially known page continues; a fully known nonempty page stops after its rows are updated. A page containing older-than-boundary reviews processes eligible rows, ignores older ones, then stops. An empty page or missing next cursor also ends sync.

### Extend History

Only an earlier requested date starts an extension. It re-fetches the old boundary page from `history_anchor_cursor` when available, upserts known rows without duplication, and imports the missing older range through the new inclusive target. The anchor is the cursor for the boundary page itself, not the cursor after it.

### Pause / Resume and Retry

Each processed page saves progress and the next opaque cursor. A soft deadline of about four minutes pauses a long `HISTORY` or `SYNC` operation for a manual Continue; no background job is scheduled. Errors retain the last valid cursor and a concise message so Retry can resume safely. Mutating operations use a document lock to prevent concurrent writes.

### Cancel Sync & Repair

For a `PAUSED` `SYNC`, confirmation cancels the operation and removes rows strictly older than `import_from_date` from that source's review tab. In-range rows, other tabs, and the prior successful last-sync timestamp are preserved; coverage is recalculated from remaining reviews.

## Provider Architecture

`ProviderRegistry.js` strictly selects by canonical `store`: `cafebazaar` resolves to `CafeBazaarProvider`, while a missing or unsupported store fails clearly without a fallback. `CafeBazaarProvider.js` maps API reviews to the internal review shape and carries each original payload as `rawReview`. `CafeBazaarApi.js` owns CafeBazaar transport, request format, newest-first sort, bounded HTTP retries, response parsing, and provider-specific errors. History and Sync receive normalized reviews plus an opaque next cursor. Myket and SibApp providers are not implemented.

## CafeBazaar API

The provider sends JSON `POST` requests to `https://api.cafebazaar.ir/rest-v1/process/ReviewRequest`:

```json
{
  "singleRequest": {
    "reviewRequest": {
      "packageName": "com.example.app",
      "cursor": "",
      "sortBy": 1
    }
  }
}
```

`sortBy: 1` selects Newest. The response carries `properties.statusCode`, reviews at `singleReply.reviewReply.reviews`, and `singleReply.reviewReply.nextPageCursor`. Both HTTP and logical status are checked. A returned cursor is opaque and passed unchanged as the next request's `cursor`; it is never derived from a review ID. The endpoint is an external dependency that may change; this project does not claim it is an officially supported public API.

## Project Structure

| Path | Responsibility |
| --- | --- |
| `src/Code.js` | Menu, panel entry point, and sidebar-facing functions |
| `src/Config.js` | Core schemas and runtime constants |
| `src/AppRepository.js` | Apps registry, migration, and sheet-ID lookup |
| `src/ReviewRepository.js` | Review rows, upsert, sorting, repair, and coverage |
| `src/OperationService.js` | Validation, locking, and operation lifecycle |
| `src/HistoryImportService.js` | Initial and extended history processing |
| `src/SyncService.js` | New-review sync processing |
| `src/ProviderRegistry.js` | Strict store-to-provider selection |
| `src/CafeBazaarProvider.js` | CafeBazaar review normalization |
| `src/CafeBazaarApi.js` | CafeBazaar HTTP request and response handling |
| `src/ReadmeSheet.js` | Idempotent in-spreadsheet `README` creation |
| `src/Sidebar.html` | Spreadsheet sidebar UI |
| `src/Utils.js` | Date and review-row helpers |
| `src/appsscript.json` | Apps Script V8 manifest and scopes |
| `tests/` | Node tests and synthetic fixtures |

## Developer Setup

Maintainers need Node.js 18+, [`clasp`](https://github.com/google/clasp), a Google account, and the Google Apps Script API enabled in their Apps Script settings. Create/open the target Google Sheet and its bound project through **Extensions → Apps Script**, then copy that project's Script ID from Project Settings.

The local repository is the source of truth. Copy `.clasp.json.example` to the local `.clasp.json`, replace the placeholder with the **intended bound project's** Script ID, and keep `"rootDir": "src"`. `.clasp.json` is ignored and must never be committed. On Windows PowerShell:

```powershell
Copy-Item .clasp.json.example .clasp.json
npm.cmd install
npm.cmd test
clasp.cmd login
clasp.cmd push
```

Reload the target spreadsheet, authorize when prompted, open **CafeBazaar Reviews → Open Panel**, and smoke-test it. When switching between DEV and TEMPLATE projects, intentionally change only the local `.clasp.json` Script ID and verify the target before every push. No multi-target deployment helper is used. Other shells can use `npm install`, `npm test`, `clasp login`, and `clasp push`.

## Testing

Run `npm test` (or `npm.cmd test` on Windows). The Node tests use mocks and synthetic fixtures; they do not normally call the live CafeBazaar API. After meaningful Apps Script changes, manually smoke-test on a DEV bound spreadsheet before updating the template.

## OAuth / Permissions

The manifest requests `spreadsheets.currentonly` for the bound spreadsheet, `script.external_request` for CafeBazaar HTTP calls, and `script.container.ui` for the Sheet menu/sidebar. It does not request broad access to other spreadsheets.

## Limitations

CafeBazaar is the only implemented store provider. There is no scheduled/background sync, dashboard or AI analysis, or ability to send review replies. The tool is designed for a bound Google Sheets Apps Script project, and existing copied templates do not auto-update. CafeBazaar API behavior may change; review the endpoint's status and applicable terms independently before wide distribution.

## Privacy

Imported review data is stored in the user's Google Sheet. Do not commit real review exports, account IDs, credentials, Script IDs, or the local `.clasp.json`.

## License

[MIT License](LICENSE).
