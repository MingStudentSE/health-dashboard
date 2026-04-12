import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDriveReaderScript = path.join(projectRoot, "scripts", "public_drive_json_reader.py");
const importerScript = path.join(projectRoot, "src", "importHealthToSqlite.mjs");
const defaultJsonDir = path.join(projectRoot, "json");
const syncLogPath = path.join(projectRoot, "data", "sync-log.jsonl");
const syncManifestPath = path.join(projectRoot, "data", "sync-manifest.json");
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

function createEmptyManifest() {
  return {
    schemaVersion: 1,
    folder: "",
    lastCheckedAt: null,
    lastSyncedAt: null,
    files: {},
  };
}

async function loadManifest() {
  try {
    const raw = await fs.readFile(syncManifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const files = parsed?.files && typeof parsed.files === "object" && !Array.isArray(parsed.files) ? parsed.files : {};
    return {
      ...createEmptyManifest(),
      ...parsed,
      files,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return createEmptyManifest();
    }
    throw error;
  }
}

async function saveManifest(manifest) {
  await fs.mkdir(path.dirname(syncManifestPath), { recursive: true });
  await fs.writeFile(syncManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizeArchivePath(fileName) {
  return path.join("json", path.basename(fileName));
}

async function inspectJsonArchive(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    const metrics = Array.isArray(parsed?.data?.metrics) ? parsed.data.metrics : [];
    const rowCount = metrics.reduce((total, metric) => total + (Array.isArray(metric?.data) ? metric.data.length : 0), 0);
    return {
      exists: true,
      metricGroups: metrics.length,
      rowCount,
      isEmptyExport: rowCount === 0,
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        exists: false,
        metricGroups: 0,
        rowCount: 0,
        isEmptyExport: false,
      };
    }

    return {
      exists: true,
      metricGroups: 0,
      rowCount: 0,
      isEmptyExport: true,
    };
  }
}

async function getRemoteJsonFiles(folder) {
  const stdout = await runCommandCapture("python3", [publicDriveReaderScript, "list", "--folder", folder], "Drive list");
  const parsed = JSON.parse(stdout);
  return parsed.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && item.name.toLowerCase().endsWith(".json"));
}

async function listLocalJsonFiles(jsonDir) {
  try {
    const entries = await fs.readdir(jsonDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => ({
        name: entry.name,
        archivePath: path.relative(projectRoot, path.resolve(jsonDir, entry.name)),
      }));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function hydrateManifestFromRemoteAndLocal(manifest, remoteFiles, localFiles) {
  const localByName = new Map(localFiles.map((file) => [file.name, file]));

  for (const remoteFile of remoteFiles) {
    const existingEntry = manifest.files[remoteFile.id];
    const localMatch = localByName.get(remoteFile.name);
    const archivePath = localMatch?.archivePath || existingEntry?.archivePath || normalizeArchivePath(remoteFile.name);
    const status = existingEntry?.status || (localMatch ? "unverified_local" : "missing");

    manifest.files[remoteFile.id] = {
      id: remoteFile.id,
      name: remoteFile.name,
      archivePath,
      status,
      downloadedAt: existingEntry?.downloadedAt ?? (localMatch ? manifest.lastCheckedAt : null),
      importedAt: existingEntry?.importedAt ?? null,
    };
  }

  return manifest;
}

async function determineRemoteDownloads(remoteFiles, manifest) {
  const downloads = [];

  for (const remoteFile of remoteFiles) {
    const entry = manifest.files[remoteFile.id];
    const archivePath = path.resolve(projectRoot, entry?.archivePath || normalizeArchivePath(remoteFile.name));
    downloads.push(
      inspectJsonArchive(archivePath).then((inspection) => ({
        remoteFile,
        entry,
        archivePath,
        inspection,
      })),
    );
  }

  return Promise.all(downloads).then((resolved) => {
    const fileIdsToDownload = [];
    const fileIdsToOverwrite = [];
    const filesToImport = [];

    for (const item of resolved) {
      const { remoteFile, entry, archivePath, inspection } = item;
      const normalizedArchivePath = path.relative(projectRoot, archivePath);

      if (
        !entry ||
        !inspection.exists ||
        entry.status === "unverified_local" ||
        entry.status === "empty_export" ||
        entry.status === "stale_today" ||
        inspection.isEmptyExport
      ) {
        fileIdsToDownload.push(remoteFile.id);
        if (inspection.exists) {
          fileIdsToOverwrite.push(remoteFile.id);
        }
        continue;
      }

      if (entry.name !== remoteFile.name || entry.archivePath !== normalizedArchivePath) {
        entry.name = remoteFile.name;
        entry.archivePath = normalizedArchivePath;
      }

      if (entry.status !== "imported") {
        filesToImport.push({
          id: remoteFile.id,
          name: remoteFile.name,
          archivePath: normalizedArchivePath,
        });
      }
    }

    return { fileIdsToDownload, fileIdsToOverwrite, filesToImport };
  });
}

async function updateManifestFromDownloads(manifest, downloadResults) {
  const now = new Date().toISOString();
  for (const result of downloadResults) {
    if (!result || result.skipped) continue;
    const fileId = result.id;
    const archivePath = path.relative(projectRoot, path.resolve(result.path));
    const inspection = await inspectJsonArchive(path.resolve(result.path));
    manifest.files[fileId] = {
      id: fileId,
      name: result.name,
      archivePath,
      status: inspection.isEmptyExport ? "empty_export" : "downloaded",
      downloadedAt: now,
      importedAt: manifest.files[fileId]?.importedAt ?? null,
    };
  }
  manifest.lastCheckedAt = now;
  return manifest;
}

async function markImported(manifest, fileIds) {
  const now = new Date().toISOString();
  for (const fileId of fileIds) {
    const entry = manifest.files[fileId];
    if (!entry) continue;
    entry.status = "imported";
    entry.importedAt = now;
  }
  manifest.lastSyncedAt = now;
  return manifest;
}

function markEmptyExports(manifest, fileIds) {
  for (const fileId of fileIds) {
    const entry = manifest.files[fileId];
    if (!entry) continue;
    entry.status = "empty_export";
    entry.importedAt = null;
  }
  return manifest;
}

function markStaleTodaySnapshots(manifest, fileIds) {
  for (const fileId of fileIds) {
    const entry = manifest.files[fileId];
    if (!entry) continue;
    entry.status = "stale_today";
    entry.importedAt = null;
  }
  return manifest;
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

  const manifest = await loadManifest();
  manifest.folder = options.folder;

  console.log("Scanning public Google Drive folder...");
  const remoteFiles = await getRemoteJsonFiles(options.folder);
  const localFiles = await listLocalJsonFiles(options.jsonDir);
  hydrateManifestFromRemoteAndLocal(manifest, remoteFiles, localFiles);
  const selectedRemoteFiles = options.latestOnly ? remoteFiles.slice(0, 1) : remoteFiles;

  const { fileIdsToDownload, fileIdsToOverwrite, filesToImport } = await determineRemoteDownloads(selectedRemoteFiles, manifest);

  const archiveResults = [];
  if (fileIdsToDownload.length) {
    const archiveArgs = [
      publicDriveReaderScript,
      "archive",
      "--folder",
      options.folder,
      "--output-dir",
      options.jsonDir,
      ...fileIdsToDownload.flatMap((fileId) => ["--file-id", fileId]),
    ];

    if (options.overwrite || fileIdsToOverwrite.length > 0) archiveArgs.push("--overwrite");

    console.log(`Downloading ${fileIdsToDownload.length} missing JSON file(s)...`);
    const archiveStdout = await runCommandCapture("python3", archiveArgs, "Drive archive");
    const downloaded = JSON.parse(archiveStdout);
    archiveResults.push(...downloaded);
    await updateManifestFromDownloads(manifest, downloaded);
    await saveManifest(manifest);
  } else {
    manifest.lastCheckedAt = new Date().toISOString();
  }

  const importCandidates = new Map();
  for (const file of filesToImport) {
    importCandidates.set(file.id, file);
  }

  for (const [fileId, entry] of Object.entries(manifest.files)) {
    if (!entry || entry.status === "imported") continue;
    const archivePath = path.resolve(projectRoot, entry.archivePath || normalizeArchivePath(entry.name || `${fileId}.json`));
    if (await pathExists(archivePath)) {
      importCandidates.set(fileId, {
        id: fileId,
        name: entry.name,
        archivePath: path.relative(projectRoot, archivePath),
      });
    }
  }

  const importFilePaths = [...importCandidates.values()]
    .map((item) => path.resolve(projectRoot, item.archivePath))
    .filter((filePath, index, array) => array.indexOf(filePath) === index);
  const downloadedFilePaths = archiveResults
    .filter((item) => item && item.skipped === false && typeof item.path === "string")
    .map((item) => path.resolve(item.path));
  const skippedFiles = remoteFiles
    .filter((item) => !fileIdsToDownload.includes(item.id))
    .map((item) => path.resolve(projectRoot, normalizeArchivePath(item.name)));
  const syncEntry = {
    timestamp: new Date().toISOString(),
    folder: options.folder,
    archivedFiles: remoteFiles.length,
    downloadedFiles: downloadedFilePaths.map((filePath) => path.basename(filePath)),
    skippedFiles: skippedFiles.map((filePath) => path.basename(filePath)),
    importedFiles: [],
    importedRows: 0,
    importedMetricGroups: 0,
    emptyExportFiles: [],
    staleTodayFiles: [],
    status: "archived",
    dashboardBuilt: false,
  };

  if (!importFilePaths.length) {
    console.log("No JSON files need importing.");
    syncEntry.status = "no_new_files";
    if (options.rebuildDashboard) {
      console.log("Rebuilding dashboard artifacts...");
      await runCommand("npm", ["run", "build:standalone"], "Dashboard build");
      syncEntry.dashboardBuilt = true;
    }
    await saveManifest(manifest);
    await appendSyncLog(syncEntry);
    return;
  }

  const importArgs = [importerScript, "--summary-json"];
  for (const filePath of importFilePaths) {
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
    const requestedFiles = Array.isArray(importSummary.fileSummaries) ? importSummary.fileSummaries : [];
    const importedFileNames = requestedFiles
      .filter((item) => item.imported && !item.isEmptyExport)
      .map((item) => item.fileName);
    const emptyExportFileNames = requestedFiles
      .filter((item) => item.isEmptyExport)
      .map((item) => item.fileName);
    const staleTodayFileNames = requestedFiles
      .filter((item) => item.isStaleTodaySnapshot)
      .map((item) => item.fileName);
    const skippedFileNames = requestedFiles
      .filter((item) => item.skipped)
      .map((item) => item.fileName);
    const pendingFileNames = requestedFiles
      .filter((item) => !item.imported && !item.skipped)
      .map((item) => item.fileName);
    const importedFileIds = [...importCandidates.entries()]
      .filter(([, item]) => importedFileNames.includes(path.basename(item.archivePath)))
      .map(([fileId]) => fileId);
    const emptyExportFileIds = [...importCandidates.entries()]
      .filter(([, item]) => emptyExportFileNames.includes(path.basename(item.archivePath)))
      .map(([fileId]) => fileId);
    const staleTodayFileIds = [...importCandidates.entries()]
      .filter(([, item]) => staleTodayFileNames.includes(path.basename(item.archivePath)))
      .map(([fileId]) => fileId);

    syncEntry.importedFiles = importedFileNames;
    syncEntry.emptyExportFiles = emptyExportFileNames;
    syncEntry.staleTodayFiles = staleTodayFileNames;
    syncEntry.importedRows = importSummary.rows ?? 0;
    syncEntry.importedMetricGroups = importSummary.metricGroups ?? 0;
    syncEntry.status = importedFileNames.length > 0
      ? "imported"
      : staleTodayFileNames.length > 0
        ? "stale_today"
      : emptyExportFileNames.length > 0
        ? "empty_export"
        : skippedFileNames.length > 0 && pendingFileNames.length === 0
          ? "no_new_files"
          : "archived";

    await markImported(manifest, importedFileIds);
    markEmptyExports(manifest, emptyExportFileIds);
    markStaleTodaySnapshots(manifest, staleTodayFileIds);
  }

  if (options.rebuildDashboard) {
    console.log("Rebuilding dashboard artifacts...");
    await runCommand("npm", ["run", "build:standalone"], "Dashboard build");
    syncEntry.dashboardBuilt = true;
  }

  await saveManifest(manifest);
  await appendSyncLog(syncEntry);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
