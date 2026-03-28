import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDriveReaderScript = path.join(projectRoot, "scripts", "public_drive_json_reader.py");
const importerScript = path.join(projectRoot, "src", "importHealthToSqlite.mjs");
const defaultJsonDir = path.join(projectRoot, "json");
const syncLogPath = path.join(projectRoot, "data", "sync-log.jsonl");
const configPath = path.join(projectRoot, "health.config.json");

function parseArgs(argv) {
  const options = {
    folder: "",
    jsonDir: defaultJsonDir,
    dbPath: "",
    overwrite: false,
    latestOnly: false,
    rebuildDashboard: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--folder" && argv[index + 1]) {
      options.folder = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--json-dir" && argv[index + 1]) {
      options.jsonDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--db" && argv[index + 1]) {
      options.dbPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === "--overwrite") {
      options.overwrite = true;
      continue;
    }

    if (arg === "--latest-only") {
      options.latestOnly = true;
      continue;
    }

    if (arg === "--build-dashboard") {
      options.rebuildDashboard = true;
      continue;
    }

    if (arg === "--skip-dashboard") {
      options.rebuildDashboard = false;
      continue;
    }
  }

  return options;
}

function runCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

function runCommandCapture(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${label} failed with exit code ${code}`));
    });
  });
}

async function appendSyncLog(entry) {
  await fs.mkdir(path.dirname(syncLogPath), { recursive: true });
  await fs.appendFile(syncLogPath, `${JSON.stringify(entry)}\n`);
}

async function readConfig() {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.driveFolder || String(parsed.driveFolder).trim() === "") {
      return {};
    }
    return parsed;
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = await readConfig();
  if (!options.folder && config.driveFolder) {
    options.folder = config.driveFolder;
  }

  if (!options.folder) {
    console.error("Usage: node src/archiveDriveJsonToSqlite.mjs --folder <GOOGLE_DRIVE_FOLDER_LINK_OR_ID> [--overwrite] [--latest-only] [--db <path>] [--json-dir <path>] [--skip-dashboard]");
    console.error("You can also set a default driveFolder in health.config.json.");
    process.exitCode = 1;
    return;
  }

  const archiveArgs = [
    publicDriveReaderScript,
    "archive",
    "--folder",
    options.folder,
    "--output-dir",
    options.jsonDir,
  ];

  if (!options.latestOnly) archiveArgs.push("--all");
  if (options.overwrite) archiveArgs.push("--overwrite");

  console.log("Archiving JSON from public Google Drive folder...");
  const archiveStdout = await runCommandCapture("python3", archiveArgs, "Drive archive");

  const archiveResults = JSON.parse(archiveStdout);
  const newFilePaths = archiveResults
    .filter((item) => item && item.skipped === false && typeof item.path === "string")
    .map((item) => path.resolve(item.path));
  const skippedFiles = archiveResults
    .filter((item) => item && item.skipped === true && typeof item.path === "string")
    .map((item) => path.resolve(item.path));
  const syncEntry = {
    timestamp: new Date().toISOString(),
    folder: options.folder,
    archivedFiles: archiveResults.length,
    downloadedFiles: newFilePaths.map((filePath) => path.basename(filePath)),
    skippedFiles: skippedFiles.map((filePath) => path.basename(filePath)),
    importedFiles: [],
    importedRows: 0,
    importedMetricGroups: 0,
    status: "archived",
    dashboardBuilt: false,
  };

  if (!newFilePaths.length) {
    console.log("No new JSON files found. Skipping SQLite import.");
    syncEntry.status = "no_new_files";
    if (options.rebuildDashboard) {
      console.log("Rebuilding dashboard artifacts...");
      await runCommand("npm", ["run", "build:standalone"], "Dashboard build");
      syncEntry.dashboardBuilt = true;
    }
    await appendSyncLog(syncEntry);
    return;
  }

  const importArgs = [importerScript, "--summary-json"];
  for (const filePath of newFilePaths) {
    importArgs.push("--file", filePath);
  }
  if (options.dbPath) {
    importArgs.push("--db", options.dbPath);
  }

  console.log("Importing archived JSON into SQLite...");
  const importStdout = await runCommandCapture("node", importArgs, "SQLite import");
  const importSummaryLine = importStdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .findLast((line) => line.startsWith("{") && line.endsWith("}"));

  if (importSummaryLine) {
    const importSummary = JSON.parse(importSummaryLine);
    syncEntry.importedFiles = newFilePaths.map((filePath) => path.basename(filePath));
    syncEntry.importedRows = importSummary.rows ?? 0;
    syncEntry.importedMetricGroups = importSummary.metricGroups ?? 0;
    syncEntry.status = "imported";
  }

  if (options.rebuildDashboard) {
    console.log("Rebuilding dashboard artifacts...");
    await runCommand("npm", ["run", "build:standalone"], "Dashboard build");
    syncEntry.dashboardBuilt = true;
  }

  await appendSyncLog(syncEntry);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
