# CafeBazaar Reviews Extractor

A Google Apps Script tool for importing and syncing CafeBazaar app reviews into Google Sheets. It runs as a script bound to your spreadsheet.

## Features

- Manage multiple CafeBazaar apps in one spreadsheet, with a separate review tab for each app.
- Run an Initial History Import from a chosen **Import From Date**, inclusive, using newest-first results.
- **Sync New Reviews** within the configured date range or **Extend History** to an earlier date.
- Resume long imports and syncs from saved pagination cursors after a safe pause.
- Upsert reviews by ID, preventing duplicates and refreshing edited reviews and counts.
- Use **Cancel Sync & Repair** to remove out-of-range rows from a paused sync.
- Preserve Persian and other Unicode review text.

## Architecture

Google Sheets → Sidebar → Apps Script → CafeBazaar Review API → app-specific review tabs

The central `Apps` tab holds each package name, review tab ID, date boundary, progress, status, and cursors. Reviews from different apps are stored in different tabs. See [Architecture](docs/ARCHITECTURE.md).

## CafeBazaar API

The tool sends `POST` requests to `https://api.cafebazaar.ir/rest-v1/process/ReviewRequest`:

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

`sortBy = 1` requests Newest. The cursor is opaque; the returned `nextPageCursor` is sent unchanged on the next request. The [API example](docs/API_EXAMPLE.md) contains only synthetic data.

## Installation

Prerequisites: a Google account, a Google Sheet, Node.js 18 or newer, and [`clasp`](https://github.com/google/clasp) (`npm install -g @google/clasp`). For local tests, run `npm install` and `npm test`; this project has no runtime npm dependencies.

1. Create or open a Google Sheet and choose **Extensions → Apps Script** to create its bound script.
2. If using clasp, enable the Google Apps Script API in your [Apps Script settings](https://script.google.com/home/usersettings).
3. In the bound script's **Project Settings**, copy its Script ID.
4. Copy `.clasp.json.example` to `.clasp.json`, replace `YOUR_GOOGLE_APPS_SCRIPT_ID`, and keep `"rootDir": "src"`.
5. Run `clasp login`, then `clasp push` from this repository. Review the push prompt before replacing code in an existing script.
6. Reload the spreadsheet, authorize the requested spreadsheet and external-request permissions, then choose **CafeBazaar Reviews → Open Panel**.

On Windows PowerShell systems that restrict `.ps1` files, use:

```powershell
npm.cmd test
clasp.cmd login
clasp.cmd push
```

Keep your real `.clasp.json` local; it is ignored by Git.

## Usage

- **Add App:** Enter an App Name, Package Name, and Import From Date, then click **Add & Import**. The selected date is included; earlier reviews are excluded.
- **Sync New Reviews:** Start at the newest reviews, insert new IDs, update known IDs, and stop at known coverage or the configured lower date boundary.
- **Extend History:** On a ready app, choose an earlier date and click **Extend History**. Choosing the same or a newer date does not delete existing reviews.
- **Continue Import / Continue Sync:** Resume a paused operation from its saved cursor. **Retry** resumes an operation in ERROR state.
- **Cancel Sync & Repair:** For a paused sync, confirm removal of rows older than Import From Date. In-range rows are preserved and the paused sync is cancelled.

See the [User Guide](docs/USER_GUIDE.md) for step-by-step instructions.

## Review sheet columns

`review_id`, `date`, `user`, `rate`, `comment`, `version_code`, `likes`, `total`, `reply`, `is_edited`, `account_id`, `avatar_url`, `user_replies_count`, `fetched_at`, `raw_json`.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/Code.js` | Menu, sidebar, and UI entry points |
| `src/Config.js` | Schema and runtime constants |
| `src/CafeBazaarApi.js` | API request and response handling |
| `src/AppRepository.js` | `Apps` metadata and sheet-ID lookup |
| `src/ReviewRepository.js` | Review rows, upsert, sorting, repair |
| `src/HistoryImportService.js` | Initial import and history pagination |
| `src/SyncService.js` | Recent-review sync |
| `src/OperationService.js` | Locking and operation lifecycle |
| `src/Utils.js` | Date normalization and page decisions |
| `src/Sidebar.html` | Spreadsheet sidebar |
| `src/appsscript.json` | Apps Script manifest |
| `tests/` | Node tests and synthetic fixtures |

## Testing

```bash
npm test
```

Tests use mocks and fixtures; they do not call the live CafeBazaar API.

## Limitations

V1 has no scheduled background sync, dashboard, AI or sentiment analysis, or ability to send review replies. It is designed for a bound Google Sheets Apps Script project. CafeBazaar API behavior may change; independently review the endpoint's public or official status and applicable terms before wide distribution.

## Privacy

Imported review data is written to the user's Google Sheet. Contributors should not commit real exported review datasets, account IDs, comments, or private `.clasp.json` files.

## License

[MIT License](LICENSE).
