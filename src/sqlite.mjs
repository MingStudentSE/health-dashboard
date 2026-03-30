import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export function quoteSql(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function runSqlite(dbPath, sql) {
  const tempFile = path.join(os.tmpdir(), `health-app-${Date.now()}.sql`);
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

export function querySqliteJson(dbPath, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn("sqlite3", ["-json", dbPath, sql], {
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
        try {
          resolve(stdout.trim() ? JSON.parse(stdout) : []);
        } catch (error) {
          reject(error);
        }
      } else {
        reject(new Error(stderr || `sqlite3 exited with code ${code}`));
      }
    });
  });
}
