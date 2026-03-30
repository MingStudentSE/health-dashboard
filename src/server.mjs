import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deleteBodyMetricsDb, readBodyMetricsDb, upsertBodyMetricsDb } from "./bodyMetrics.mjs";
import { deleteWorkoutRecordDb, insertWorkoutRecordDb, readWorkoutRecordsDb, updateWorkoutRecordDb } from "./workoutRecords.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(projectRoot, "web");
const dataFile = path.join(webRoot, "data", "health-dashboard.json");
const configPath = path.join(projectRoot, "health.config.json");
const notesDir = path.join(projectRoot, "data", "daily-notes");
const dbPath = path.join(projectRoot, "data", "health.sqlite");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function getArgValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function ensureNotesDir() {
  await fs.mkdir(notesDir, { recursive: true });
}

async function ensureDataDir() {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
}

async function listNoteMeta() {
  await ensureNotesDir();
  const fileNames = await fs.readdir(notesDir).catch(() => []);
  const entries = await Promise.all(
    fileNames
      .filter((fileName) => fileName.endsWith(".json"))
      .map(async (fileName) => {
        const payload = await readJson(path.join(notesDir, fileName), null);
        if (!payload?.date) return null;
        return [
          payload.date,
          {
            hasJournal: Boolean(String(payload.journal || "").trim()),
            updatedAt: payload.updatedAt || null,
          },
        ];
      }),
  );
  return Object.fromEntries(entries.filter(Boolean));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function safeDateKey(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function notePathForDate(date) {
  return path.join(notesDir, `${date}.json`);
}

async function saveNote(date, note) {
  await ensureNotesDir();
  const payload = {
    date,
    journal: note.journal ?? "",
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(notePathForDate(date), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function summarizeDayForPrompt(day) {
  if (!day) return "No day data found.";
  const metricLines = day.metrics
    .map((metric) => {
      const stats = metric.cards
        .slice(0, 6)
        .map((item) => `${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ""}`)
        .join("; ");
      return `- ${metric.label}: ${stats}`;
    })
    .join("\n");

  return [
    `Date: ${day.date}`,
    `Coverage: ${day.completeness.metricCount}/${day.completeness.universeCount} (${day.completeness.coveragePercent}%)`,
    `Existing heuristic summary: ${day.analysis.summary}`,
    `Findings: ${day.analysis.findings.join(" | ")}`,
    `Metrics:\n${metricLines}`,
  ].join("\n");
}

function buildFallbackFeedback(day, note) {
  const noteText = (note?.journal || "").trim();
  const reflection = noteText
    ? `你写下的日志提到了：${noteText.slice(0, 140)}${noteText.length > 140 ? "..." : ""}`
    : "今天还没有填写主观日志，所以这份反馈主要基于客观数据。";

  return {
    source: "local-fallback",
    generatedAt: new Date().toISOString(),
    title: `${day.date} 每日反馈`,
    summary: day.analysis.summary,
    reflection,
    wins: day.analysis.findings.slice(0, 3),
    suggestions: day.analysis.recommendations.slice(0, 3),
    watchouts: day.analysis.cautions.slice(0, 3),
  };
}

async function generateModelFeedback(day, note) {
  const config = await readJson(configPath, {});
  const api = config.openaiCompatible || {};
  const apiBase = api.baseUrl || process.env.OPENAI_BASE_URL || "";
  const apiKey = api.apiKey || process.env.OPENAI_API_KEY || "";
  const model = api.model || process.env.OPENAI_MODEL || "";

  if (!apiBase || !apiKey || !model) {
    return buildFallbackFeedback(day, note);
  }

  const systemPrompt = [
    "你是一个谨慎、温和、结构化的每日健康反馈助手。",
    "你只能根据用户当天的健康数据和日志给出描述性反馈，不要做临床诊断。",
    "输出 JSON，字段必须包含：title, summary, reflection, wins, suggestions, watchouts。",
    "wins/suggestions/watchouts 必须是字符串数组。",
  ].join(" ");

  const userPrompt = [
    "请根据下面的数据和日志生成一份中文的每日反馈。",
    summarizeDayForPrompt(day),
    `Journal:\n${note?.journal || "No journal entry."}`,
  ].join("\n\n");

  const endpointBase = apiBase.endsWith("/") ? apiBase : `${apiBase}/`;
  const response = await fetch(new URL("chat/completions", endpointBase), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Model API error: ${response.status} ${text}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Model API returned no content.");
  const parsed = JSON.parse(content);
  return {
    source: "openai-compatible",
    generatedAt: new Date().toISOString(),
    ...parsed,
  };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/dashboard") {
    const payload = await readJson(dataFile, {});
    payload.notesMeta = await listNoteMeta();
    payload.bodyMetrics = await readBodyMetricsDb(dbPath);
    payload.workoutRecords = await readWorkoutRecordsDb(dbPath);
    return sendJson(response, 200, payload);
  }

  if (url.pathname === "/api/body-records") {
    if (request.method === "GET") {
      const payload = await readBodyMetricsDb(dbPath);
      return sendJson(response, 200, payload);
    }
  }

  if (url.pathname === "/api/workout-records") {
    if (request.method === "GET") {
      const payload = await readWorkoutRecordsDb(dbPath);
      return sendJson(response, 200, payload);
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      await ensureDataDir();
      const saved = await insertWorkoutRecordDb(dbPath, body);
      return sendJson(response, 200, saved);
    }
  }

  const bodyRecordMatch = url.pathname.match(/^\/api\/body-records\/(\d{4}-\d{2}-\d{2})$/);
  if (bodyRecordMatch) {
    const date = safeDateKey(bodyRecordMatch[1]);
    if (!date) return sendJson(response, 400, { error: "Invalid date." });

    if (request.method === "PUT") {
      const body = await readBody(request);
      await ensureDataDir();
      const saved = await upsertBodyMetricsDb(dbPath, { ...body, date });
      return sendJson(response, 200, saved);
    }

    if (request.method === "DELETE") {
      await ensureDataDir();
      const saved = await deleteBodyMetricsDb(dbPath, date);
      return sendJson(response, 200, saved);
    }
  }

  const workoutRecordMatch = url.pathname.match(/^\/api\/workout-records\/(.+)$/);
  if (workoutRecordMatch) {
    const id = decodeURIComponent(workoutRecordMatch[1]);

    if (request.method === "PUT") {
      const body = await readBody(request);
      await ensureDataDir();
      try {
        const saved = await updateWorkoutRecordDb(dbPath, id, body);
        return sendJson(response, 200, saved);
      } catch (error) {
        return sendJson(response, 404, { error: error.message });
      }
    }

    if (request.method === "DELETE") {
      await ensureDataDir();
      const saved = await deleteWorkoutRecordDb(dbPath, id);
      return sendJson(response, 200, saved);
    }
  }

  const noteMatch = url.pathname.match(/^\/api\/days\/(\d{4}-\d{2}-\d{2})\/note$/);
  if (noteMatch) {
    const date = safeDateKey(noteMatch[1]);
    if (!date) return sendJson(response, 400, { error: "Invalid date." });

    if (request.method === "GET") {
      const payload = await readJson(notePathForDate(date), { date, journal: "", updatedAt: null });
      return sendJson(response, 200, payload);
    }

    if (request.method === "PUT") {
      const body = await readBody(request);
      const saved = await saveNote(date, body);
      return sendJson(response, 200, saved);
    }
  }

  const feedbackMatch = url.pathname.match(/^\/api\/days\/(\d{4}-\d{2}-\d{2})\/feedback$/);
  if (feedbackMatch && request.method === "POST") {
    const date = safeDateKey(feedbackMatch[1]);
    if (!date) return sendJson(response, 400, { error: "Invalid date." });

    const dashboard = await readJson(dataFile, {});
    const day = (dashboard.days || []).find((item) => item.date === date);
    if (!day) return sendJson(response, 404, { error: "Day data not found." });
    const note = await readJson(notePathForDate(date), { date, journal: "", updatedAt: null });

    try {
      const feedback = await generateModelFeedback(day, note);
      return sendJson(response, 200, feedback);
    } catch (error) {
      return sendJson(response, 500, {
        error: error.message,
        fallback: buildFallbackFeedback(day, note),
      });
    }
  }

  return false;
}

async function serveStatic(response, pathname) {
  let resolvedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.join(webRoot, resolvedPath);
  const safeRoot = path.resolve(webRoot);
  const safePath = path.resolve(filePath);
  if (!safePath.startsWith(safeRoot)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(safePath);
    const ext = path.extname(safePath);
    response.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
    response.end(file);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }
    sendText(response, 500, String(error));
  }
}

async function main() {
  const port = Number(getArgValue("--port", process.env.PORT || 3030));
  const host = getArgValue("--host", process.env.HOST || "127.0.0.1");

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host}`);
      const handled = await handleApi(request, response, url);
      if (handled !== false) return;
      await serveStatic(response, url.pathname);
    } catch (error) {
      sendJson(response, 500, { error: String(error.message || error) });
    }
  });

  server.listen(port, host, () => {
    console.log(`Health app running at http://${host}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
