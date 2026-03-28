# Health Dashboard

[中文说明](./README.md)

A self-contained local pipeline for turning exported health JSON files into:

- an incremental SQLite archive
- a multi-day health summary dataset
- a static HTML dashboard with lightweight analysis
- a daily reflection page with journaling and feedback

The project is designed for workflows like:

`Google Drive -> JSON archive -> SQLite -> dashboard`

## Before You Start

This project is not a generic health data collector. It assumes you already have Apple Health data being exported to Google Drive on an ongoing basis.

- Use an iPhone or another Apple device that supports Apple Health
- Store or sync your health data through Apple's built-in `Health` app
- Install the `Health Auto Export` app
- Purchase and enable the premium subscription used for the automation-based sync workflow in this project
- Configure Google Drive sync in `Health Auto Export` so your health data is continuously exported as JSON files

Official setup guide:

- [Health Auto Export: Sync Apple Health Data to Google Drive](https://help.healthyapps.dev/en/health-auto-export/automations/google-drive/)

This repository assumes that the setup above is already complete and that you have a Google Drive folder containing the exported JSON files.

## What It Does

- Downloads only new JSON files from a public Google Drive folder
- Keeps the original JSON files in a local `json/` archive
- Imports only new or changed files into SQLite
- Builds a static dashboard from the archived data
- Writes a small sync log for each run

## Output

After a successful sync, the main outputs are:

- `data/health.sqlite`
- `web/data/health-dashboard.json`
- `web/health-dashboard-standalone.html`

When running in app mode, the project also uses:

- `data/daily-notes/<date>.json`
- `/api/days/:date/note`
- `/api/days/:date/feedback`

The standalone HTML file can be opened directly in a browser without a local server.

## Privacy and Git Hygiene

The repository is set up to commit source code and directory scaffolding only, not personal health data or local secrets.

- `health.config.json` is ignored
- raw exports inside `json/` are ignored
- SQLite files, sync logs, and daily notes inside `data/` are ignored
- `web/data/health-dashboard.json` and `web/health-dashboard-standalone.html` are ignored

This makes it safer to keep iterating on the open-source project while keeping your real health data local.

## Project Layout

```text
health/
├─ json/                         # Archived raw health JSON files
├─ data/                         # Runtime artifacts (ignored by git)
├─ scripts/
│  └─ public_drive_json_reader.py
├─ src/
│  ├─ archiveDriveJsonToSqlite.mjs
│  ├─ importHealthToSqlite.mjs
│  ├─ buildDashboardData.mjs
│  └─ buildStandaloneDashboard.mjs
├─ web/
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  └─ data/health-dashboard.json
├─ health.config.example.json
└─ package.json
```

## Requirements

- Node.js 18+
- Python 3
- `sqlite3`

Check your environment:

```bash
node --version
python3 --version
sqlite3 --version
```

## Quick Start

1. Clone the repository.

```bash
git clone <your-repo-url>
cd health
```

2. Create a local config file.

```bash
cp health.config.example.json health.config.json
```

3. Edit `health.config.json` and set `driveFolder` to your public Google Drive folder link or folder ID.

Example:

```json
{
  "driveFolder": "https://drive.google.com/drive/folders/YOUR_FOLDER_ID"
}
```

4. Run the full pipeline.

```bash
npm run sync:drive
```

5. Open the generated dashboard:

```text
web/health-dashboard-standalone.html
```

If you want the daily pages, journaling, and generated feedback flow, start the local app:

```bash
npm run start
```

Or simply double-click `run.command` in the repository root.

If you want the app to check Google Drive first, sync only when new exports exist, and then launch, double-click `sync-and-run.command`.

Then open:

```text
http://127.0.0.1:3030
```

## Commands

Run the full incremental sync pipeline:

```bash
npm run sync:drive
```

Run sync with an explicit folder:

```bash
npm run sync:drive -- --folder "https://drive.google.com/drive/folders/..."
```

Download only the latest JSON file:

```bash
npm run sync:drive -- --latest-only
```

Skip dashboard rebuild:

```bash
npm run sync:drive -- --skip-dashboard
```

Import archived JSON files into SQLite:

```bash
npm run import:sqlite
```

Rebuild dashboard files only:

```bash
npm run build:standalone
```

Start the local app:

```bash
npm run start
```

Or run:

```bash
./run.command
```

To check for new exports, sync incrementally, and then start the app:

```bash
./sync-and-run.command
```

## Incremental Behavior

The project is designed to avoid repeated work:

- Existing JSON filenames are not downloaded again unless `--overwrite` is used
- Files already imported with the same content hash are skipped during SQLite import
- Each sync appends a line to `data/sync-log.jsonl`

## SQLite Schema

Main tables and views:

- `imported_files`
- `metric_records`
- `daily_metric_totals`
- `daily_sleep_summary`

Example queries:

Daily step totals:

```bash
sqlite3 data/health.sqlite "
SELECT day, total_qty AS steps
FROM daily_metric_totals
WHERE metric_name = 'step_count'
ORDER BY day;
"
```

Daily heart rate summary:

```bash
sqlite3 data/health.sqlite "
SELECT day, avg_avg_value AS avg_heart_rate, max_value AS max_heart_rate
FROM daily_metric_totals
WHERE metric_name = 'heart_rate'
ORDER BY day;
"
```

Daily sleep summary:

```bash
sqlite3 data/health.sqlite "
SELECT day, in_bed_hours, asleep_hours, deep_hours, rem_hours, sleep_start, sleep_end
FROM daily_sleep_summary
ORDER BY day;
"
```

## Dashboard

The generated dashboard is a static page built from local data. It currently includes:

- recent health status analysis
- trend charts and trend interpretation
- a report calendar
- summary preview before opening a specific day

## Daily Reflection Pages

The project now includes dedicated per-day pages:

- open a day from the report calendar
- review the professional analysis, full metrics, and charts for that date
- write a journal note
- generate a daily feedback summary based on both the data and the journal

Journal files are stored locally at:

```text
data/daily-notes/YYYY-MM-DD.json
```

## OpenAI-Compatible API

Daily feedback supports OpenAI-compatible model endpoints.

Configure this in `health.config.json`:

```json
{
  "driveFolder": "",
  "openaiCompatible": {
    "baseUrl": "https://your-api-base-url",
    "apiKey": "your-api-key",
    "model": "your-model-name"
  }
}
```

If no model config is provided, the project falls back to a local heuristic feedback generator so it still runs end to end.

## Notes

- This project is intended for personal data workflows, not medical diagnosis
- The dashboard analysis is heuristic and descriptive, not clinical advice
- The Google Drive folder must be publicly readable for the bundled reader to work

## GitHub-Friendly Defaults

The repository is set up so that personal runtime files stay local:

- `health.config.json` is ignored
- `data/*.sqlite` is ignored
- `data/sync-log.jsonl` is ignored
- `data/daily-notes/` is ignored

You can choose whether to keep sample JSON files in `json/` for demos, or remove them before publishing.
