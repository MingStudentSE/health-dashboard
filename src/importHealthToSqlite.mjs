import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonDir = path.join(projectRoot, "json");
const defaultDbPath = path.join(projectRoot, "data", "health.sqlite");

function parseArgs(argv) {
  const options = {
    dbPath: defaultDbPath,
    jsonDir,
    files: [],
    summaryJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db" && argv[index + 1]) {
      options.dbPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--json-dir" && argv[index + 1]) {
      options.jsonDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--file" && argv[index + 1]) {
      options.files.push(path.resolve(argv[index + 1]));
      index += 1;
      continue;
    }

    if (arg === "--summary-json") {
      options.summaryJson = true;
    }
  }

  return options;
}

function quoteSql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toIsoTimestamp(value) {
  if (!value) return null;
  const normalized = value.replace(" +0800", "+08:00").replace(" +0000", "+00:00");
  const timestamp = new Date(normalized);
  if (Number.isNaN(timestamp.getTime())) return null;
  return timestamp.toISOString();
}

function createFileHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function createSchemaSql() {
  return `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS imported_files (
  file_name TEXT PRIMARY KEY,
  file_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS metric_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  units TEXT,
  source TEXT,
  record_at TEXT,
  qty REAL,
  min_value REAL,
  max_value REAL,
  avg_value REAL,
  in_bed REAL,
  awake REAL,
  total_sleep REAL,
  rem REAL,
  core REAL,
  deep REAL,
  asleep REAL,
  sleep_start TEXT,
  sleep_end TEXT,
  in_bed_start TEXT,
  in_bed_end TEXT,
  raw_json TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (file_name) REFERENCES imported_files(file_name) ON DELETE CASCADE,
  UNIQUE (file_name, metric_name, record_at, source, raw_json)
);

CREATE INDEX IF NOT EXISTS idx_metric_records_name_time
ON metric_records (metric_name, record_at);

CREATE INDEX IF NOT EXISTS idx_metric_records_file
ON metric_records (file_name);

CREATE VIEW IF NOT EXISTS daily_metric_totals AS
SELECT
  DATE(record_at, 'localtime') AS day,
  metric_name,
  units,
  ROUND(SUM(COALESCE(qty, 0)), 4) AS total_qty,
  ROUND(AVG(avg_value), 4) AS avg_avg_value,
  ROUND(MAX(max_value), 4) AS max_value,
  COUNT(*) AS sample_count
FROM metric_records
GROUP BY DATE(record_at, 'localtime'), metric_name, units;

CREATE VIEW IF NOT EXISTS daily_sleep_summary AS
SELECT
  DATE(record_at, 'localtime') AS day,
  ROUND(
    COALESCE(
      NULLIF(MAX(in_bed), 0),
      (julianday(MAX(sleep_end)) - julianday(MIN(sleep_start))) * 24.0
    ),
    4
  ) AS in_bed_hours,
  ROUND(
    COALESCE(
      NULLIF(MAX(asleep), 0),
      (julianday(MAX(sleep_end)) - julianday(MIN(sleep_start))) * 24.0
    ),
    4
  ) AS asleep_hours,
  ROUND(MAX(deep), 4) AS deep_hours,
  ROUND(MAX(rem), 4) AS rem_hours,
  MIN(sleep_start) AS sleep_start,
  MAX(sleep_end) AS sleep_end,
  MAX(source) AS source
FROM metric_records
WHERE metric_name = 'sleep_analysis'
GROUP BY DATE(record_at, 'localtime');
`;
}

function createInsertStatements(fileName, fileHash, metrics) {
  const statements = [];
  statements.push(
    `INSERT INTO imported_files (file_name, file_hash) VALUES (${quoteSql(fileName)}, ${quoteSql(fileHash)}) ` +
      `ON CONFLICT(file_name) DO UPDATE SET file_hash = excluded.file_hash, imported_at = CURRENT_TIMESTAMP;`,
  );

  for (const metric of metrics) {
    const rows = Array.isArray(metric.data) ? metric.data : [];
    for (const row of rows) {
      const recordAt = toIsoTimestamp(row.date);
      const source = row.source ?? null;
      const rawJson = JSON.stringify(row);

      statements.push(`
INSERT OR IGNORE INTO metric_records (
  file_name, metric_name, units, source, record_at, qty, min_value, max_value, avg_value,
  in_bed, awake, total_sleep, rem, core, deep, asleep,
  sleep_start, sleep_end, in_bed_start, in_bed_end, raw_json
) VALUES (
  ${quoteSql(fileName)},
  ${quoteSql(metric.name ?? null)},
  ${quoteSql(metric.units ?? null)},
  ${quoteSql(source)},
  ${quoteSql(recordAt)},
  ${quoteSql(row.qty ?? null)},
  ${quoteSql(row.Min ?? null)},
  ${quoteSql(row.Max ?? null)},
  ${quoteSql(row.Avg ?? null)},
  ${quoteSql(row.inBed ?? null)},
  ${quoteSql(row.awake ?? null)},
  ${quoteSql(row.totalSleep ?? null)},
  ${quoteSql(row.rem ?? null)},
  ${quoteSql(row.core ?? null)},
  ${quoteSql(row.deep ?? null)},
  ${quoteSql(row.asleep ?? null)},
  ${quoteSql(toIsoTimestamp(row.sleepStart))},
  ${quoteSql(toIsoTimestamp(row.sleepEnd))},
  ${quoteSql(toIsoTimestamp(row.inBedStart))},
  ${quoteSql(toIsoTimestamp(row.inBedEnd))},
  ${quoteSql(rawJson)}
);`.trim());
    }
  }

  return statements.join("\n");
}

async function runSqlite(dbPath, sql) {
  const tempFile = path.join(os.tmpdir(), `health-import-${Date.now()}.sql`);
  await fs.writeFile(tempFile, sql);

  await new Promise((resolve, reject) => {
    const child = spawn("sqlite3", [dbPath], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `sqlite3 exited with code ${code}`));
    });

    child.stdin?.end(`.read ${tempFile}\n`);
  });

  await fs.unlink(tempFile).catch(() => {});
}

function querySqliteLines(dbPath, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", ["-noheader", dbPath, sql], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(
          stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        );
      } else {
        reject(new Error(stderr || `sqlite3 exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(path.dirname(options.dbPath), { recursive: true });
  await runSqlite(options.dbPath, createSchemaSql());

  let filePaths = [];
  if (options.files.length) {
    filePaths = [...new Set(options.files)].sort();
  } else {
    filePaths = (await fs.readdir(options.jsonDir))
      .filter((fileName) => fileName.endsWith(".json"))
      .sort()
      .map((fileName) => path.join(options.jsonDir, fileName));
  }

  if (!filePaths.length) {
    console.log(`No JSON files found to import.`);
    return;
  }

  const importedRows = await querySqliteLines(
    options.dbPath,
    "SELECT file_name || '|' || file_hash FROM imported_files;",
  );
  const importedMap = new Map(
    importedRows.map((row) => {
      const separatorIndex = row.indexOf("|");
      if (separatorIndex === -1) return [row, ""];
      return [row.slice(0, separatorIndex), row.slice(separatorIndex + 1)];
    }),
  );

  let totalMetrics = 0;
  let totalRows = 0;
  let skippedFiles = 0;
  let importedFiles = 0;
  let sql = "BEGIN;\n";

  for (const filePath of filePaths) {
    const fileName = path.basename(filePath);
    const content = await fs.readFile(filePath, "utf8");
    const fileHash = createFileHash(content);

    if (importedMap.get(fileName) === fileHash) {
      skippedFiles += 1;
      continue;
    }

    const parsed = JSON.parse(content);
    const metrics = parsed?.data?.metrics ?? [];

    totalMetrics += metrics.length;
    totalRows += metrics.reduce((count, metric) => count + (Array.isArray(metric.data) ? metric.data.length : 0), 0);
    importedFiles += 1;
    sql += `${createInsertStatements(fileName, fileHash, metrics)}\n`;
  }

  if (importedFiles > 0) {
    sql += "COMMIT;\n";
    await runSqlite(options.dbPath, sql);
  }

  const summary = {
    dbPath: options.dbPath,
    requestedFiles: filePaths.length,
    importedFiles,
    skippedFiles,
    metricGroups: totalMetrics,
    rows: totalRows,
  };

  console.log(`Imported ${importedFiles} file(s), skipped ${skippedFiles}, ${totalMetrics} metric group(s), ${totalRows} row(s).`);
  console.log(`SQLite DB ready at ${options.dbPath}`);

  if (options.summaryJson) {
    console.log(JSON.stringify(summary));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
