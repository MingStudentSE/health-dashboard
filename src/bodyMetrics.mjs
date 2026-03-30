import fs from "node:fs/promises";
import path from "node:path";
import { quoteSql, querySqliteJson, runSqlite } from "./sqlite.mjs";

export const defaultBodyMetricsPayload = {
  records: [],
  generatedAt: null,
  latestDate: null,
  latestRecord: null,
  summary: {
    hero: [],
    highlights: [],
    recommendations: [],
  },
  trendSeries: [],
};

const bodyMetricFields = [
  "weight",
  "bodyFatRate",
  "skeletalMuscle",
  "chest",
  "waist",
  "hip",
  "bodyAge",
  "score",
];

const bodyMetricLabels = {
  weight: { label: "体重", unit: "kg", digits: 1 },
  bodyFatRate: { label: "体脂率", unit: "%", digits: 1 },
  skeletalMuscle: { label: "骨骼肌", unit: "kg", digits: 1 },
  chest: { label: "胸围", unit: "cm", digits: 1 },
  waist: { label: "腰围", unit: "cm", digits: 1 },
  hip: { label: "臀围", unit: "cm", digits: 1 },
  bodyAge: { label: "身体年龄", unit: "岁", digits: 1 },
  score: { label: "评分", unit: "/100", digits: 0 },
};

function round(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
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

function metricMeta(field) {
  return bodyMetricLabels[field] ?? { label: field, unit: "", digits: 1 };
}

function formatChange(current, previous, digits = 1) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const delta = round(current - previous, digits);
  if (!Number.isFinite(delta) || delta === 0) return "持平";
  return `${delta > 0 ? "+" : ""}${delta}`;
}

function getPreviousRecord(records, date) {
  const currentIndex = records.findIndex((record) => record.date === date);
  if (currentIndex <= 0) return null;
  return records[currentIndex - 1];
}

function createFieldCard(field, value, previousValue) {
  const meta = metricMeta(field);
  const normalizedValue = round(value, meta.digits);
  const delta = formatChange(normalizedValue, previousValue, meta.digits);
  return {
    field,
    label: meta.label,
    value: normalizedValue,
    unit: meta.unit,
    delta,
  };
}

function buildRecordAnalysis(record, previousRecord) {
  const findings = [];
  const recommendations = [];

  if (Number.isFinite(record.bodyFatRate)) {
    if (record.bodyFatRate >= 25) {
      findings.push(`体脂率 ${record.bodyFatRate}% 偏高，当前更像“脂肪偏多、肌肉偏少”的阶段。`);
      recommendations.push("优先做减脂和保肌的组合，不建议只盯体重下降。");
    } else if (record.bodyFatRate >= 18) {
      findings.push(`体脂率 ${record.bodyFatRate}% 处于可继续优化区间。`);
    } else {
      findings.push(`体脂率 ${record.bodyFatRate}% 相对不错，重点转向维持体型与肌肉质量。`);
    }
  }

  if (Number.isFinite(record.skeletalMuscle)) {
    if (record.skeletalMuscle < 28) {
      findings.push(`骨骼肌 ${record.skeletalMuscle}kg 偏少，基础代谢和线条支撑会受影响。`);
      recommendations.push("力量训练和蛋白质摄入要稳定，不然容易继续掉肌肉。");
    } else {
      findings.push(`骨骼肌 ${record.skeletalMuscle}kg 还不错，说明有保留住一部分身体支撑。`);
    }
  }

  if (Number.isFinite(record.waist) && Number.isFinite(record.hip) && record.hip > 0) {
    const whr = round(record.waist / record.hip, 2);
    if (whr >= 0.9) {
      findings.push(`腰臀比 ${whr} 偏高，脂肪更集中在腰腹。`);
      recommendations.push("围度改善优先盯腰围，比只看体重更能反映脂肪变化。");
    } else {
      findings.push(`腰臀比 ${whr} 还可以，脂肪分布没有明显集中到腰腹。`);
    }
  }

  if (previousRecord) {
    const trackedChanges = [];
    for (const field of ["weight", "bodyFatRate", "skeletalMuscle", "waist", "hip"]) {
      if (!Number.isFinite(record[field]) || !Number.isFinite(previousRecord[field])) continue;
      const meta = metricMeta(field);
      const delta = formatChange(record[field], previousRecord[field], meta.digits);
      if (!delta || delta === "持平") continue;
      trackedChanges.push(`${meta.label}${delta}${meta.unit}`);
    }
    if (trackedChanges.length) findings.push(`相较上一次记录，${trackedChanges.join("，")}。`);
    else findings.push("和上一次记录相比，核心指标变化不大。");
  } else {
    findings.push("这是当前序列中的第一条身体记录，后续记录后才能看变化趋势。");
  }

  if (!recommendations.length) recommendations.push("继续按固定时间记录，优先保证数据连续性。");

  return {
    summary:
      findings[0] ??
      "这次身体记录已经保存，随着记录变多，页面会给出更有连续性的变化判断。",
    findings: findings.slice(0, 4),
    recommendations: recommendations.slice(0, 3),
  };
}

function buildTrendSeries(records) {
  return bodyMetricFields.map((field) => {
    const meta = metricMeta(field);
    return {
      field,
      label: meta.label,
      unit: meta.unit,
      points: records
        .filter((record) => Number.isFinite(record[field]))
        .map((record) => ({
          label: record.date.slice(5),
          value: round(record[field], meta.digits),
        })),
    };
  });
}

function buildSummary(records) {
  const latestRecord = records.at(-1) ?? null;
  const previousRecord = latestRecord ? getPreviousRecord(records, latestRecord.date) : null;

  if (!latestRecord) {
    return {
      latestDate: null,
      latestRecord: null,
      summary: {
        hero: [],
        highlights: ["还没有身体数据记录，可以先录入第一条体重、体脂和三围。"],
        recommendations: ["建议至少每周固定记录 1 到 2 次，趋势会比单次更有意义。"],
      },
    };
  }

  const hero = ["weight", "bodyFatRate", "skeletalMuscle", "waist", "hip", "score"]
    .filter((field) => Number.isFinite(latestRecord[field]))
    .map((field) => {
      const meta = metricMeta(field);
      return {
        label: meta.label,
        value: round(latestRecord[field], meta.digits),
        unit: meta.unit,
        delta: previousRecord ? formatChange(latestRecord[field], previousRecord[field], meta.digits) : null,
      };
    });

  return {
    latestDate: latestRecord.date,
    latestRecord,
    summary: {
      hero,
      highlights: latestRecord.analysis.findings.slice(0, 3),
      recommendations: latestRecord.analysis.recommendations.slice(0, 3),
    },
  };
}

export function normalizeBodyRecord(input, existingRecord = null) {
  const date = normalizeDate(input?.date ?? existingRecord?.date);
  if (!date) throw new Error("Invalid date. Expected YYYY-MM-DD.");

  const normalized = {
    date,
    note: cleanText(input?.note ?? existingRecord?.note ?? ""),
    createdAt: existingRecord?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  for (const field of bodyMetricFields) {
    normalized[field] = toFiniteNumber(input?.[field] ?? existingRecord?.[field]);
  }

  return normalized;
}

function sanitizeRow(row) {
  return {
    date: row.date,
    note: cleanText(row.note),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    weight: toFiniteNumber(row.weight),
    bodyFatRate: toFiniteNumber(row.body_fat_rate),
    skeletalMuscle: toFiniteNumber(row.skeletal_muscle),
    chest: toFiniteNumber(row.chest),
    waist: toFiniteNumber(row.waist),
    hip: toFiniteNumber(row.hip),
    bodyAge: toFiniteNumber(row.body_age),
    score: toFiniteNumber(row.score),
  };
}

function createSchemaSql() {
  return `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS body_measurements (
  date TEXT PRIMARY KEY,
  weight REAL,
  body_fat_rate REAL,
  skeletal_muscle REAL,
  chest REAL,
  waist REAL,
  hip REAL,
  body_age REAL,
  score REAL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;
}

export async function ensureBodyMetricsSchema(dbPath) {
  await runSqlite(dbPath, createSchemaSql());
}

export async function migrateBodyMetricsJsonToDb(dbPath, jsonFilePath) {
  await ensureBodyMetricsSchema(dbPath);
  const rowCount = await querySqliteJson(dbPath, "SELECT COUNT(*) AS count FROM body_measurements;");
  if ((rowCount[0]?.count ?? 0) > 0) return;

  try {
    const raw = await fs.readFile(jsonFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed?.records) ? parsed.records : [];
    if (!records.length) return;

    const statements = records
      .map((record) => {
        const normalized = normalizeBodyRecord(record, record);
        return `
INSERT INTO body_measurements (
  date, weight, body_fat_rate, skeletal_muscle, chest, waist, hip, body_age, score, note, created_at, updated_at
) VALUES (
  ${quoteSql(normalized.date)},
  ${quoteSql(normalized.weight)},
  ${quoteSql(normalized.bodyFatRate)},
  ${quoteSql(normalized.skeletalMuscle)},
  ${quoteSql(normalized.chest)},
  ${quoteSql(normalized.waist)},
  ${quoteSql(normalized.hip)},
  ${quoteSql(normalized.bodyAge)},
  ${quoteSql(normalized.score)},
  ${quoteSql(normalized.note)},
  ${quoteSql(normalized.createdAt)},
  ${quoteSql(normalized.updatedAt)}
)
ON CONFLICT(date) DO UPDATE SET
  weight = excluded.weight,
  body_fat_rate = excluded.body_fat_rate,
  skeletal_muscle = excluded.skeletal_muscle,
  chest = excluded.chest,
  waist = excluded.waist,
  hip = excluded.hip,
  body_age = excluded.body_age,
  score = excluded.score,
  note = excluded.note,
  updated_at = excluded.updated_at;`.trim();
      })
      .join("\n");

    if (statements) await runSqlite(dbPath, statements);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function buildBodyMetricsPayload(recordsInput = []) {
  const records = recordsInput
    .map((record) => sanitizeRow(record))
    .sort((left, right) => left.date.localeCompare(right.date));

  const enrichedRecords = records.map((record) => {
    const previousRecord = getPreviousRecord(records, record.date);
    const cards = bodyMetricFields
      .filter((field) => Number.isFinite(record[field]))
      .map((field) => createFieldCard(field, record[field], previousRecord?.[field]));

    const analysis = buildRecordAnalysis(record, previousRecord);
    const whr =
      Number.isFinite(record.waist) && Number.isFinite(record.hip) && record.hip > 0
        ? round(record.waist / record.hip, 2)
        : null;

    return {
      ...record,
      cards,
      whr,
      analysis,
    };
  });

  const summaryBlock = buildSummary(enrichedRecords);

  return {
    records: enrichedRecords,
    generatedAt: new Date().toISOString(),
    latestDate: summaryBlock.latestDate,
    latestRecord: summaryBlock.latestRecord,
    summary: summaryBlock.summary,
    trendSeries: buildTrendSeries(enrichedRecords),
  };
}

export async function readBodyMetricsDb(dbPath, jsonFilePath = path.join(path.dirname(dbPath), "body-records.json")) {
  await migrateBodyMetricsJsonToDb(dbPath, jsonFilePath);
  const rows = await querySqliteJson(
    dbPath,
    `SELECT date, weight, body_fat_rate, skeletal_muscle, chest, waist, hip, body_age, score, note, created_at, updated_at
     FROM body_measurements
     ORDER BY date ASC;`,
  );
  return buildBodyMetricsPayload(rows);
}

export async function upsertBodyMetricsDb(dbPath, record, jsonFilePath = path.join(path.dirname(dbPath), "body-records.json")) {
  await migrateBodyMetricsJsonToDb(dbPath, jsonFilePath);
  const normalized = normalizeBodyRecord(record, record);
  await runSqlite(
    dbPath,
    `
INSERT INTO body_measurements (
  date, weight, body_fat_rate, skeletal_muscle, chest, waist, hip, body_age, score, note, created_at, updated_at
) VALUES (
  ${quoteSql(normalized.date)},
  ${quoteSql(normalized.weight)},
  ${quoteSql(normalized.bodyFatRate)},
  ${quoteSql(normalized.skeletalMuscle)},
  ${quoteSql(normalized.chest)},
  ${quoteSql(normalized.waist)},
  ${quoteSql(normalized.hip)},
  ${quoteSql(normalized.bodyAge)},
  ${quoteSql(normalized.score)},
  ${quoteSql(normalized.note)},
  ${quoteSql(normalized.createdAt)},
  ${quoteSql(normalized.updatedAt)}
)
ON CONFLICT(date) DO UPDATE SET
  weight = excluded.weight,
  body_fat_rate = excluded.body_fat_rate,
  skeletal_muscle = excluded.skeletal_muscle,
  chest = excluded.chest,
  waist = excluded.waist,
  hip = excluded.hip,
  body_age = excluded.body_age,
  score = excluded.score,
  note = excluded.note,
  updated_at = excluded.updated_at;`,
  );
  return readBodyMetricsDb(dbPath, jsonFilePath);
}

export async function deleteBodyMetricsDb(dbPath, date, jsonFilePath = path.join(path.dirname(dbPath), "body-records.json")) {
  await migrateBodyMetricsJsonToDb(dbPath, jsonFilePath);
  await runSqlite(dbPath, `DELETE FROM body_measurements WHERE date = ${quoteSql(date)};`);
  return readBodyMetricsDb(dbPath, jsonFilePath);
}
