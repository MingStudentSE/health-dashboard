import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { quoteSql, querySqliteJson, runSqlite } from "./sqlite.mjs";

export const defaultWorkoutPayload = {
  records: [],
  generatedAt: null,
  latestRecord: null,
  summary: {
    hero: [],
    highlights: [],
  },
};

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAreaList(value) {
  const source = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const areas = [];

  for (const item of source) {
    const parts = cleanText(item)
      .split(/[、,，/]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    for (const part of parts) {
      if (!areas.includes(part)) areas.push(part);
    }
  }

  return areas;
}

function parseAreaColumn(value) {
  if (!value) return [];
  if (Array.isArray(value)) return normalizeAreaList(value);

  try {
    return normalizeAreaList(JSON.parse(value));
  } catch {
    return normalizeAreaList(value);
  }
}

function toFiniteNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function makeId() {
  return `workout_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeSet(item = {}) {
  return {
    reps: toFiniteNumber(item.reps),
    weight: toFiniteNumber(item.weight),
  };
}

function normalizeExercise(item = {}) {
  const name = cleanText(item.name);
  const targetAreas = cleanText(item.targetAreas);
  const sets = Array.isArray(item.sets) ? item.sets.map((setItem) => normalizeSet(setItem)).filter((setItem) => setItem.reps || setItem.weight) : [];

  if (!name && !targetAreas && !sets.length) return null;

  return { name, targetAreas, sets };
}

function deriveTrainedAreas(exercises = [], explicitAreas = []) {
  const normalizedExplicitAreas = normalizeAreaList(explicitAreas);
  if (normalizedExplicitAreas.length) return normalizedExplicitAreas;
  return normalizeAreaList(exercises.map((exercise) => exercise.targetAreas));
}

export function normalizeWorkoutRecord(input, existingRecord = null) {
  const date = normalizeDate(input?.date ?? existingRecord?.date);
  if (!date) throw new Error("Invalid date. Expected YYYY-MM-DD.");

  const exercises = Array.isArray(input?.exercises)
    ? input.exercises.map((exercise) => normalizeExercise(exercise)).filter(Boolean)
    : Array.isArray(existingRecord?.exercises)
      ? existingRecord.exercises.map((exercise) => normalizeExercise(exercise)).filter(Boolean)
      : [];

  return {
    id: existingRecord?.id || cleanText(input?.id) || makeId(),
    date,
    coachEvaluation: cleanText(input?.coachEvaluation ?? existingRecord?.coachEvaluation),
    personalFeedback: cleanText(input?.personalFeedback ?? existingRecord?.personalFeedback),
    trainedAreas: deriveTrainedAreas(exercises, input?.trainedAreas),
    exercises,
    createdAt: existingRecord?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function summarizeRecord(record) {
  const exerciseCount = record.exercises.length;
  const totalSets = record.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  const totalVolume = record.exercises.reduce(
    (sum, exercise) =>
      sum +
      exercise.sets.reduce((exerciseSum, setItem) => {
        const reps = Number.isFinite(setItem.reps) ? setItem.reps : 0;
        const weight = Number.isFinite(setItem.weight) ? setItem.weight : 0;
        return exerciseSum + reps * weight;
      }, 0),
    0,
  );

  const trainedAreas = deriveTrainedAreas(record.exercises, record.trainedAreas);

  const highlights = [];
  if (exerciseCount) highlights.push(`本次共训练 ${exerciseCount} 个动作，完成 ${totalSets} 组。`);
  if (trainedAreas.length) highlights.push(`本次训练部位清单：${trainedAreas.join("、")}。`);
  if (totalVolume > 0) highlights.push(`粗略训练总容量约 ${Math.round(totalVolume)} kg。`);
  if (record.coachEvaluation) highlights.push(`教练评价：${record.coachEvaluation}`);
  if (record.personalFeedback) highlights.push(`个人反馈：${record.personalFeedback}`);

  return {
    exerciseCount,
    totalSets,
    totalVolume,
    targetAreas: trainedAreas,
    trainedAreas,
    highlights: highlights.slice(0, 4),
  };
}

function sanitizeJoinedRows(rows) {
  const sessionMap = new Map();

  for (const row of rows) {
    if (!sessionMap.has(row.session_id)) {
      sessionMap.set(row.session_id, {
        id: row.session_id,
        date: row.workout_date,
        coachEvaluation: cleanText(row.coach_evaluation),
        personalFeedback: cleanText(row.personal_feedback),
        trainedAreas: parseAreaColumn(row.trained_areas),
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        exercises: [],
      });
    }

    const session = sessionMap.get(row.session_id);
    if (!row.exercise_id) continue;

    let exercise = session.exercises.find((item) => item.__exerciseId === row.exercise_id);
    if (!exercise) {
      exercise = {
        __exerciseId: row.exercise_id,
        name: cleanText(row.exercise_name),
        targetAreas: cleanText(row.target_areas),
        sets: [],
      };
      session.exercises.push(exercise);
    }

    if (row.set_id) {
      exercise.sets.push({
        reps: toFiniteNumber(row.reps),
        weight: toFiniteNumber(row.weight),
      });
    }
  }

  return Array.from(sessionMap.values()).map((session) => ({
    ...session,
    trainedAreas: session.trainedAreas.length ? session.trainedAreas : deriveTrainedAreas(session.exercises),
    exercises: session.exercises.map(({ __exerciseId, ...exercise }) => exercise),
  }));
}

function createSchemaSql() {
  return `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workout_sessions (
  id TEXT PRIMARY KEY,
  workout_date TEXT NOT NULL,
  coach_evaluation TEXT,
  personal_feedback TEXT,
  trained_areas TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  name TEXT,
  target_areas TEXT,
  FOREIGN KEY (session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  reps REAL,
  weight REAL,
  FOREIGN KEY (exercise_id) REFERENCES workout_exercises(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workout_sessions_date
ON workout_sessions (workout_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workout_exercises_session
ON workout_exercises (session_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_workout_sets_exercise
ON workout_sets (exercise_id, sort_order);
`;
}

export async function ensureWorkoutSchema(dbPath) {
  await runSqlite(dbPath, createSchemaSql());

  const columns = await querySqliteJson(dbPath, "PRAGMA table_info(workout_sessions);");
  const hasTrainedAreasColumn = columns.some((column) => column.name === "trained_areas");
  if (!hasTrainedAreasColumn) {
    await runSqlite(dbPath, "ALTER TABLE workout_sessions ADD COLUMN trained_areas TEXT;");
  }

  const rowsNeedingBackfill = await querySqliteJson(
    dbPath,
    "SELECT COUNT(*) AS count FROM workout_sessions WHERE trained_areas IS NULL OR TRIM(COALESCE(trained_areas, '')) = '';",
  );
  if ((rowsNeedingBackfill[0]?.count ?? 0) > 0) {
    const rows = await querySqliteJson(
      dbPath,
      `
SELECT
  ws.id AS session_id,
  ws.workout_date,
  ws.coach_evaluation,
  ws.personal_feedback,
  ws.trained_areas,
  ws.created_at,
  ws.updated_at,
  we.id AS exercise_id,
  we.name AS exercise_name,
  we.target_areas,
  wset.id AS set_id,
  wset.reps,
  wset.weight
FROM workout_sessions ws
LEFT JOIN workout_exercises we ON we.session_id = ws.id
LEFT JOIN workout_sets wset ON wset.exercise_id = we.id
ORDER BY ws.workout_date ASC, ws.created_at ASC, we.sort_order ASC, wset.sort_order ASC;`,
    );
    const sessions = sanitizeJoinedRows(rows);
    const statements = sessions.map(
      (session) =>
        `UPDATE workout_sessions SET trained_areas = ${quoteSql(JSON.stringify(session.trainedAreas || []))} WHERE id = ${quoteSql(session.id)};`,
    );
    if (statements.length) {
      await runSqlite(dbPath, statements.join("\n"));
    }
  }
}

async function replaceWorkoutRecord(dbPath, record) {
  const normalized = normalizeWorkoutRecord(record, record);
  const statements = [
    `DELETE FROM workout_sessions WHERE id = ${quoteSql(normalized.id)};`,
    `
INSERT INTO workout_sessions (id, workout_date, coach_evaluation, personal_feedback, trained_areas, created_at, updated_at)
VALUES (
  ${quoteSql(normalized.id)},
  ${quoteSql(normalized.date)},
  ${quoteSql(normalized.coachEvaluation)},
  ${quoteSql(normalized.personalFeedback)},
  ${quoteSql(JSON.stringify(normalized.trainedAreas || []))},
  ${quoteSql(normalized.createdAt)},
  ${quoteSql(normalized.updatedAt)}
);`.trim(),
  ];

  normalized.exercises.forEach((exercise, exerciseIndex) => {
    statements.push(`
INSERT INTO workout_exercises (session_id, sort_order, name, target_areas)
VALUES (
  ${quoteSql(normalized.id)},
  ${exerciseIndex},
  ${quoteSql(exercise.name)},
  ${quoteSql(exercise.targetAreas)}
);`.trim());

    exercise.sets.forEach((setItem, setIndex) => {
      statements.push(`
INSERT INTO workout_sets (exercise_id, sort_order, reps, weight)
SELECT id, ${setIndex}, ${quoteSql(setItem.reps)}, ${quoteSql(setItem.weight)}
FROM workout_exercises
WHERE session_id = ${quoteSql(normalized.id)} AND sort_order = ${exerciseIndex};`.trim());
    });
  });

  await runSqlite(dbPath, statements.join("\n"));
}

export async function migrateWorkoutJsonToDb(dbPath, jsonFilePath = path.join(path.dirname(dbPath), "workout-records.json")) {
  await ensureWorkoutSchema(dbPath);
  const rowCount = await querySqliteJson(dbPath, "SELECT COUNT(*) AS count FROM workout_sessions;");
  if ((rowCount[0]?.count ?? 0) > 0) return;

  try {
    const raw = await fs.readFile(jsonFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    for (const record of records) {
      await replaceWorkoutRecord(dbPath, record);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function buildWorkoutPayload(recordsInput = []) {
  const records = recordsInput
    .sort((left, right) => {
      const dateCompare = left.date.localeCompare(right.date);
      if (dateCompare !== 0) return dateCompare;
      return (left.createdAt || "").localeCompare(right.createdAt || "");
    })
    .map((record) => ({
      ...record,
      summary: summarizeRecord(record),
    }));

  const latestRecord = records.at(-1) ?? null;

  return {
    records,
    generatedAt: new Date().toISOString(),
    latestRecord,
    summary: {
      hero: latestRecord
        ? [
            { label: "最近训练日", value: latestRecord.date },
            { label: "动作数", value: latestRecord.summary.exerciseCount, unit: "个" },
            { label: "总组数", value: latestRecord.summary.totalSets, unit: "组" },
            { label: "训练容量", value: Math.round(latestRecord.summary.totalVolume), unit: "kg" },
          ]
        : [],
      highlights: latestRecord?.summary.highlights ?? ["还没有健身记录，先添加第一堂训练。"],
    },
  };
}

export async function readWorkoutRecordsDb(dbPath, jsonFilePath = path.join(path.dirname(dbPath), "workout-records.json")) {
  await migrateWorkoutJsonToDb(dbPath, jsonFilePath);
  const rows = await querySqliteJson(
    dbPath,
    `
SELECT
  ws.id AS session_id,
  ws.workout_date,
  ws.coach_evaluation,
  ws.personal_feedback,
  ws.trained_areas,
  ws.created_at,
  ws.updated_at,
  we.id AS exercise_id,
  we.name AS exercise_name,
  we.target_areas,
  wset.id AS set_id,
  wset.reps,
  wset.weight
FROM workout_sessions ws
LEFT JOIN workout_exercises we ON we.session_id = ws.id
LEFT JOIN workout_sets wset ON wset.exercise_id = we.id
ORDER BY ws.workout_date ASC, ws.created_at ASC, we.sort_order ASC, wset.sort_order ASC;`,
  );
  return buildWorkoutPayload(sanitizeJoinedRows(rows));
}

export async function insertWorkoutRecordDb(dbPath, record, jsonFilePath = path.join(path.dirname(dbPath), "workout-records.json")) {
  await migrateWorkoutJsonToDb(dbPath, jsonFilePath);
  await replaceWorkoutRecord(dbPath, record);
  return readWorkoutRecordsDb(dbPath, jsonFilePath);
}

export async function updateWorkoutRecordDb(dbPath, id, record, jsonFilePath = path.join(path.dirname(dbPath), "workout-records.json")) {
  await migrateWorkoutJsonToDb(dbPath, jsonFilePath);
  const existing = await querySqliteJson(
    dbPath,
    `SELECT id, workout_date, coach_evaluation, personal_feedback, trained_areas, created_at, updated_at
     FROM workout_sessions
     WHERE id = ${quoteSql(id)}
     LIMIT 1;`,
  );
  if (!existing.length) throw new Error("Workout record not found.");

  const nextRecord = normalizeWorkoutRecord(
    {
      ...record,
      id,
      date: record?.date ?? existing[0].workout_date,
      coachEvaluation: record?.coachEvaluation ?? existing[0].coach_evaluation,
      personalFeedback: record?.personalFeedback ?? existing[0].personal_feedback,
      createdAt: existing[0].created_at,
    },
    {
      id,
      date: existing[0].workout_date,
      coachEvaluation: existing[0].coach_evaluation,
      personalFeedback: existing[0].personal_feedback,
      exercises: Array.isArray(record?.exercises) ? record.exercises : [],
      createdAt: existing[0].created_at,
      updatedAt: existing[0].updated_at,
    },
  );

  await replaceWorkoutRecord(dbPath, nextRecord);
  return readWorkoutRecordsDb(dbPath, jsonFilePath);
}

export async function deleteWorkoutRecordDb(dbPath, id, jsonFilePath = path.join(path.dirname(dbPath), "workout-records.json")) {
  await migrateWorkoutJsonToDb(dbPath, jsonFilePath);
  await runSqlite(dbPath, `DELETE FROM workout_sessions WHERE id = ${quoteSql(id)};`);
  return readWorkoutRecordsDb(dbPath, jsonFilePath);
}
