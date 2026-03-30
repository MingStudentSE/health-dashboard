import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readBodyMetricsDb } from "./bodyMetrics.mjs";
import { readWorkoutRecordsDb } from "./workoutRecords.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonDir = path.join(projectRoot, "json");
const outputDir = path.join(projectRoot, "web", "data");
const outputFile = path.join(outputDir, "health-dashboard.json");
const dbPath = path.join(projectRoot, "data", "health.sqlite");

const metricLabels = {
  step_count: "步数",
  active_energy: "活跃能量",
  basal_energy_burned: "基础能量",
  walking_running_distance: "步行跑步距离",
  heart_rate: "心率",
  sleep_analysis: "睡眠分析",
};

const primaryMetricOrder = [
  "step_count",
  "sleep_analysis",
  "heart_rate",
  "active_energy",
  "basal_energy_burned",
  "walking_running_distance",
];

function extractDateFromName(fileName) {
  const match = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : fileName;
}

function parseTimestamp(value) {
  if (!value) return null;
  return new Date(String(value).replace(" +0800", "+08:00"));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function average(values = []) {
  if (!values.length) return 0;
  return values.reduce((total, item) => total + item, 0) / values.length;
}

function sum(values = []) {
  return values.reduce((total, item) => total + item, 0);
}

function numericValues(data = [], key) {
  return data
    .map((item) => Number(item[key]))
    .filter((value) => Number.isFinite(value));
}

function labelForMetric(name) {
  return metricLabels[name] ?? name.replaceAll("_", " ");
}

function choosePrimaryField(data = []) {
  const candidates = ["qty", "Avg", "asleep", "inBed", "totalSleep", "Max", "Min"];
  for (const key of candidates) {
    if (data.some((item) => Number.isFinite(Number(item[key])))) return key;
  }
  return null;
}

function groupByHour(data = [], valueGetter, reducer = "sum") {
  const buckets = new Map();

  for (const item of data) {
    const timestamp = parseTimestamp(item.date);
    if (!timestamp || Number.isNaN(timestamp.getTime())) continue;
    const hour = String(timestamp.getHours()).padStart(2, "0");
    const value = valueGetter(item);
    if (!Number.isFinite(value)) continue;
    if (!buckets.has(hour)) buckets.set(hour, []);
    buckets.get(hour).push(value);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([hour, values]) => ({
      hour,
      value: round(reducer === "avg" ? average(values) : sum(values), 2),
    }));
}

function createStat(label, value, unit = "") {
  return { label, value, unit };
}

function summarizeQuantityMetric(metric, digits = 1) {
  const data = metric.data || [];
  const qtyValues = numericValues(data, "qty");
  const total = round(sum(qtyValues), digits);
  const averagePerSample = round(average(qtyValues), digits);
  const timeline = groupByHour(data, (item) => Number(item.qty || 0), "sum");
  const peak = timeline.reduce((best, point) => (point.value > (best?.value ?? -Infinity) ? point : best), null);

  return {
    keyMetric: total,
    keyUnit: metric.units ?? "",
    cards: [
      createStat("总量", total, metric.units ?? ""),
      createStat("样本数", data.length),
      createStat("单次均值", averagePerSample, metric.units ?? ""),
      createStat("峰值时段", peak ? `${peak.hour}:00` : "暂无"),
    ],
    charts: [
      {
        id: `${metric.name}-hourly`,
        title: `${labelForMetric(metric.name)}分时分布`,
        type: "bar",
        unit: metric.units ?? "",
        points: timeline.map((point) => ({ label: point.hour, value: point.value })),
      },
    ],
    insights: peak
      ? [`高峰集中在 ${peak.hour}:00 左右，${labelForMetric(metric.name)} 在这个时段最活跃。`]
      : ["当前只有很少的有效采样，暂时难以判断分布节律。"],
  };
}

function summarizeHeartRate(metric) {
  const data = metric.data || [];
  const avgValues = numericValues(data, "Avg");
  const minValues = numericValues(data, "Min");
  const maxValues = numericValues(data, "Max");
  const timeline = groupByHour(data, (item) => Number(item.Avg), "avg");
  const restingWindow = timeline.filter((point) => point.hour >= "00" && point.hour <= "06");
  const recoverySignal = restingWindow.length ? round(average(restingWindow.map((point) => point.value)), 1) : 0;
  const minHeartRate = minValues.length ? round(Math.min(...minValues), 0) : 0;
  const maxHeartRate = maxValues.length ? round(Math.max(...maxValues), 0) : 0;
  const avgHeartRate = round(average(avgValues), 1);

  return {
    keyMetric: avgHeartRate,
    keyUnit: "bpm",
    cards: [
      createStat("平均心率", avgHeartRate, "bpm"),
      createStat("最低心率", minHeartRate, "bpm"),
      createStat("最高心率", maxHeartRate, "bpm"),
      createStat("夜间均值", recoverySignal, "bpm"),
    ],
    charts: [
      {
        id: "heart-rate-hourly",
        title: "分时平均心率",
        type: "line",
        unit: "bpm",
        points: timeline.map((point) => ({ label: point.hour, value: point.value })),
      },
    ],
    insights: [
      `全日平均心率约 ${avgHeartRate} bpm。`,
      recoverySignal ? `夜间 00:00-06:00 的平均心率约 ${recoverySignal} bpm，可作为恢复平稳度参考。` : "当前没有足够的夜间心率样本。",
    ],
  };
}

function summarizeSleep(metric) {
  const data = metric.data || [];
  const first = data[0] || {};
  const inBed = round(Number(first.inBed || 0), 2);
  const asleep = round(Number(first.asleep || first.totalSleep || 0), 2);
  const deep = round(Number(first.deep || 0), 2);
  const rem = round(Number(first.rem || 0), 2);
  const core = round(Number(first.core || 0), 2);
  const awake = round(Number(first.awake || 0), 2);
  const efficiency = inBed > 0 && asleep > 0 ? round((asleep / inBed) * 100, 0) : 0;

  return {
    keyMetric: inBed,
    keyUnit: "h",
    cards: [
      createStat("卧床时长", inBed, "h"),
      createStat("有效睡眠", asleep, "h"),
      createStat("睡眠效率", efficiency, "%"),
      createStat("清醒时长", awake, "h"),
      createStat("深睡", deep, "h"),
      createStat("REM", rem, "h"),
      createStat("核心睡眠", core, "h"),
      createStat("数据源", first.source || "未知"),
    ],
    charts: [
      {
        id: "sleep-stage-breakdown",
        title: "睡眠阶段拆解",
        type: "bar",
        unit: "h",
        points: [
          { label: "卧床", value: inBed },
          { label: "睡着", value: asleep },
          { label: "深睡", value: deep },
          { label: "REM", value: rem },
          { label: "核心", value: core },
          { label: "清醒", value: awake },
        ],
      },
    ],
    period: {
      start: first.inBedStart || first.sleepStart || null,
      end: first.inBedEnd || first.sleepEnd || null,
    },
    insights: [
      inBed ? `总卧床时长约 ${inBed} 小时。` : "当前没有有效的卧床时长数据。",
      asleep ? `有效睡眠约 ${asleep} 小时。` : "当前没有有效的睡眠时长数据。",
      deep || rem || core
        ? `阶段拆解显示深睡 ${deep}h、REM ${rem}h、核心睡眠 ${core}h。`
        : "睡眠阶段数据较少，暂时更适合看总时长而不是结构。",
    ],
  };
}

function summarizeMetric(metric) {
  if (!metric) return null;

  let result;
  switch (metric.name) {
    case "heart_rate":
      result = summarizeHeartRate(metric);
      break;
    case "sleep_analysis":
      result = summarizeSleep(metric);
      break;
    case "step_count":
      result = summarizeQuantityMetric(metric, 0);
      break;
    case "walking_running_distance":
      result = summarizeQuantityMetric(metric, 2);
      break;
    case "active_energy":
    case "basal_energy_burned":
      result = summarizeQuantityMetric(metric, 1);
      break;
    default: {
      const data = metric.data || [];
      const primaryField = choosePrimaryField(data);
      const values = primaryField ? numericValues(data, primaryField) : [];
      result = {
        keyMetric: values.length ? round(sum(values), 2) : data.length,
        keyUnit: primaryField === "qty" ? metric.units ?? "" : "",
        cards: [
          createStat("样本数", data.length),
          ...(values.length
            ? [
                createStat("总量", round(sum(values), 2), metric.units ?? ""),
                createStat("均值", round(average(values), 2), metric.units ?? ""),
              ]
            : []),
        ],
        charts: values.length
          ? [
              {
                id: `${metric.name}-generic`,
                title: `${labelForMetric(metric.name)}分布`,
                type: "bar",
                unit: metric.units ?? "",
                points: groupByHour(data, (item) => Number(item[primaryField]), "sum").map((point) => ({
                  label: point.hour,
                  value: point.value,
                })),
              },
            ]
          : [],
        insights: [`当前共记录 ${data.length} 条 ${labelForMetric(metric.name)} 数据。`],
      };
    }
  }

  return {
    name: metric.name,
    label: labelForMetric(metric.name),
    units: metric.units || "",
    sampleCount: Array.isArray(metric.data) ? metric.data.length : 0,
    ...result,
  };
}

function buildComprehensiveAnalysis(day) {
  const findings = [];
  const recommendations = [];
  const cautions = [];
  let score = 70;

  const metricNames = new Set(day.metrics.map((metric) => metric.name));
  const sleep = day.metricMap.sleep_analysis;
  const steps = day.metricMap.step_count;
  const active = day.metricMap.active_energy;
  const basal = day.metricMap.basal_energy_burned;
  const distance = day.metricMap.walking_running_distance;
  const heart = day.metricMap.heart_rate;

  findings.push(`当天共覆盖 ${metricNames.size} 类指标，数据完整度为 ${day.completeness.coveragePercent}%。`);

  if (sleep) {
    const sleepHours = sleep.cards.find((item) => item.label === "卧床时长")?.value ?? 0;
    const efficiency = sleep.cards.find((item) => item.label === "睡眠效率")?.value ?? 0;
    if (sleepHours >= 7) {
      score += 10;
      findings.push(`卧床时长 ${sleepHours} 小时，恢复窗口相对充足。`);
    } else if (sleepHours > 0) {
      score -= 6;
      findings.push(`卧床时长 ${sleepHours} 小时，恢复窗口偏短。`);
      recommendations.push("今晚尽量提前进入睡前缓冲，给恢复更多时间。");
    } else {
      cautions.push("睡眠记录缺失，恢复判断可信度偏低。");
    }

    if (efficiency > 0) {
      findings.push(`睡眠效率约 ${efficiency}% 。`);
      if (efficiency < 85) {
        recommendations.push("如果连续多天效率偏低，可以重点回看入睡时间和中途醒来情况。");
      }
    }
  } else {
    cautions.push("当天没有睡眠分析，建议先确保穿戴设备或同步流程完整。");
  }

  if (steps) {
    const stepTotal = steps.cards.find((item) => item.label === "总量")?.value ?? 0;
    if (stepTotal >= 8000) {
      score += 8;
      findings.push(`步数 ${stepTotal}，整体活动量充足。`);
    } else if (stepTotal >= 5000) {
      score += 3;
      findings.push(`步数 ${stepTotal}，基础活动尚可。`);
    } else {
      score -= 6;
      findings.push(`步数 ${stepTotal}，活动量偏少。`);
      recommendations.push("安排一次 20 到 30 分钟的轻快步行，补足基础活动量。");
    }
  }

  if (distance) {
    const distanceTotal = distance.cards.find((item) => item.label === "总量")?.value ?? 0;
    findings.push(`步行跑步距离约 ${distanceTotal} km。`);
  }

  if (heart) {
    const avgHeartRate = heart.cards.find((item) => item.label === "平均心率")?.value ?? 0;
    const maxHeartRate = heart.cards.find((item) => item.label === "最高心率")?.value ?? 0;
    if (avgHeartRate > 0 && avgHeartRate <= 78) {
      score += 6;
      findings.push(`平均心率 ${avgHeartRate} bpm，节律整体平稳。`);
    } else if (avgHeartRate > 85) {
      score -= 7;
      findings.push(`平均心率 ${avgHeartRate} bpm，偏高。`);
      recommendations.push("今天更适合保守强度，注意补水和拉低整体压力。");
    }

    if (maxHeartRate >= 100) {
      cautions.push(`最高心率达到 ${maxHeartRate} bpm，若并非运动时段，建议回看当时状态。`);
    }
  }

  if (active && basal) {
    const activeTotal = active.cards.find((item) => item.label === "总量")?.value ?? 0;
    const basalTotal = basal.cards.find((item) => item.label === "总量")?.value ?? 0;
    const activeShare = basalTotal > 0 ? round((activeTotal / basalTotal) * 100, 0) : 0;
    findings.push(`活跃能量约占基础能量的 ${activeShare}% 。`);

    if (activeTotal >= 900) {
      score += 4;
      recommendations.push("今天输出偏高，记得补充蛋白质与电解质。");
    } else if (activeTotal > 0 && activeTotal < 400) {
      findings.push("活跃能量刺激偏轻。");
      recommendations.push("如果体感允许，可以补一段轻运动或拉伸。");
    }
  }

  if (day.completeness.coveragePercent < 60) {
    score -= 6;
    cautions.push("指标覆盖率偏低，当前分析更适合当作观察笔记，而不是高置信判断。");
  }

  score = Math.max(28, Math.min(96, Math.round(score)));
  let tone = "稳中偏轻";
  if (score >= 86) tone = "状态良好";
  else if (score >= 74) tone = "平稳可用";
  else if (score >= 60) tone = "需要修复";
  else tone = "优先恢复";

  const summaryMap = {
    状态良好: "恢复、活动和心率节律整体比较协调，可以把今天视为一张较完整的健康切片。",
    平稳可用: "整体数据可用，状态不差，但仍有一两个维度值得继续优化。",
    需要修复: "恢复和活动之间出现了一些失衡，建议把注意力放回睡眠和低压力活动。",
    优先恢复: "当前最值得优先修复的是恢复与负荷平衡，今天不适合追求更高输出。",
  };

  if (!recommendations.length) {
    recommendations.push("保持当前节奏，并继续观察连续几天的走势。");
  }
  if (!cautions.length) {
    cautions.push("今天没有非常突出的风险信号，但仍建议以多日趋势为准。");
  }

  return {
    score,
    tone,
    summary: summaryMap[tone],
    findings: findings.slice(0, 6),
    recommendations: recommendations.slice(0, 5),
    cautions: cautions.slice(0, 4),
  };
}

function buildDayRecord(fileName, parsed, metricUniverse) {
  const sourceMetrics = parsed?.data?.metrics || [];
  const summarizedMetrics = sourceMetrics.map((metric) => summarizeMetric(metric)).filter(Boolean);
  const metricMap = Object.fromEntries(summarizedMetrics.map((metric) => [metric.name, metric]));
  const coveragePercent = metricUniverse.length ? round((summarizedMetrics.length / metricUniverse.length) * 100, 0) : 0;

  const summary = {
    steps: metricMap.step_count?.keyMetric ?? 0,
    activeEnergy: metricMap.active_energy?.keyMetric ?? 0,
    basalEnergy: metricMap.basal_energy_burned?.keyMetric ?? 0,
    distance: metricMap.walking_running_distance?.keyMetric ?? 0,
    sleepHours: metricMap.sleep_analysis?.keyMetric ?? 0,
    heartRateAvg: metricMap.heart_rate?.keyMetric ?? 0,
    heartRateMax: metricMap.heart_rate?.cards.find((item) => item.label === "最高心率")?.value ?? 0,
  };

  const orderedMetrics = summarizedMetrics.sort((a, b) => {
    const left = primaryMetricOrder.indexOf(a.name);
    const right = primaryMetricOrder.indexOf(b.name);
    if (left !== -1 || right !== -1) {
      return (left === -1 ? 999 : left) - (right === -1 ? 999 : right);
    }
    return a.label.localeCompare(b.label, "zh-CN");
  });

  const day = {
    date: extractDateFromName(fileName),
    fileName,
    metricsAvailable: orderedMetrics.map((metric) => metric.name),
    completeness: {
      metricCount: orderedMetrics.length,
      universeCount: metricUniverse.length,
      coveragePercent,
    },
    summary,
    metrics: orderedMetrics,
    metricMap,
  };

  day.analysis = buildComprehensiveAnalysis(day);
  return day;
}

function createRecentOverview(dayRecords) {
  const recentDays = dayRecords.slice(-7);
  const latest = recentDays.at(-1) ?? null;
  if (!latest) {
    return {
      rangeLabel: "暂无数据",
      hero: [],
      analysis: {
        title: "最近状态分析",
        summary: "当前还没有足够的数据生成最近状态分析。",
        findings: ["请先导入至少一天健康数据。"],
        recommendations: [],
        cautions: [],
      },
    };
  }

  const averageMetric = (getter) =>
    round(
      average(
        recentDays
          .map(getter)
          .filter((value) => Number.isFinite(value) && value > 0),
      ),
      1,
    );

  const avgSleep = averageMetric((day) => day.summary.sleepHours);
  const avgSteps = round(
    average(
      recentDays
        .map((day) => day.summary.steps)
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
    0,
  );
  const avgHeartRate = averageMetric((day) => day.summary.heartRateAvg);
  const avgCoverage = round(average(recentDays.map((day) => day.completeness.coveragePercent)), 0);
  const scoreAvg = round(average(recentDays.map((day) => day.analysis.score)), 0);
  const first = recentDays[0];
  const last = recentDays.at(-1);

  const findings = [
    `最近观察窗口覆盖 ${recentDays.length} 天，平均数据覆盖率为 ${avgCoverage}%。`,
    avgSleep ? `最近平均睡眠约 ${avgSleep} 小时。` : "最近缺少稳定的睡眠记录。",
    avgSteps ? `最近平均步数约 ${avgSteps}。` : "最近缺少稳定的步数记录。",
    avgHeartRate ? `最近平均心率约 ${avgHeartRate} bpm。` : "最近缺少稳定的心率记录。",
  ];

  const recommendations = [];
  const cautions = [];

  if (avgSleep && avgSleep < 6.5) {
    recommendations.push("最近睡眠时长偏短，建议优先把作息拉回到更稳定的恢复节奏。");
  }
  if (avgSteps && avgSteps < 5000) {
    recommendations.push("最近整体活动量偏轻，可以把轻快步行作为最容易坚持的补量动作。");
  }
  if (avgHeartRate && avgHeartRate > 82) {
    cautions.push("最近平均心率偏高，建议结合疲劳感、压力和睡眠一起观察。");
  }
  if (avgCoverage < 70) {
    cautions.push("最近有较多日期的数据覆盖不足，趋势判断需要保留一点弹性。");
  }
  if (first && last && last.summary.steps > 0 && first.summary.steps > 0) {
    const stepDelta = round(last.summary.steps - first.summary.steps, 0);
    findings.push(`相较窗口起点，最新一天步数变化 ${stepDelta >= 0 ? "+" : ""}${stepDelta}。`);
  }

  if (!recommendations.length) {
    recommendations.push("最近整体状态可用，继续保持规律记录，重点观察连续 7 天的变化。");
  }
  if (!cautions.length) {
    cautions.push("当前没有特别突出的近期警报，但仍建议把多日趋势放在单日波动之前看。");
  }

  const summary =
    scoreAvg >= 82
      ? "最近这段时间整体状态较稳，恢复和活动之间的平衡感不错。"
      : scoreAvg >= 68
        ? "最近这段时间整体可用，但恢复质量和活动量还有优化空间。"
        : "最近这段时间更像处在修复期，建议优先照顾睡眠、压力和基础活动。";

  return {
    rangeLabel: `${first?.date ?? latest.date} - ${latest.date}`,
    hero: [
      { label: "最近日期", value: latest.date },
      { label: "最近睡眠", value: latest.summary.sleepHours, unit: "h" },
      { label: "最近步数", value: latest.summary.steps, unit: "" },
      { label: "最近心率", value: latest.summary.heartRateAvg, unit: "bpm" },
      { label: "最近评分", value: latest.analysis.score, unit: "/100" },
      { label: "最近覆盖率", value: latest.completeness.coveragePercent, unit: "%" },
    ],
    analysis: {
      title: "最近状态分析",
      summary,
      findings: findings.slice(0, 5),
      recommendations: recommendations.slice(0, 4),
      cautions: cautions.slice(0, 4),
    },
  };
}

async function main() {
  const fileNames = (await fs.readdir(jsonDir))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  const parsedEntries = [];
  const metricUniverse = new Set();
  for (const fileName of fileNames) {
    const filePath = path.join(jsonDir, fileName);
    const content = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(content);
    parsedEntries.push([fileName, parsed]);
    for (const metric of parsed?.data?.metrics || []) {
      metricUniverse.add(metric.name);
    }
  }

  const metricCatalog = Array.from(metricUniverse)
    .sort((a, b) => {
      const left = primaryMetricOrder.indexOf(a);
      const right = primaryMetricOrder.indexOf(b);
      if (left !== -1 || right !== -1) {
        return (left === -1 ? 999 : left) - (right === -1 ? 999 : right);
      }
      return a.localeCompare(b, "zh-CN");
    })
    .map((name) => ({ name, label: labelForMetric(name) }));

  const dayRecords = parsedEntries.map(([fileName, parsed]) => buildDayRecord(fileName, parsed, metricCatalog.map((item) => item.name)));
  dayRecords.sort((a, b) => a.date.localeCompare(b.date));

  const latest = dayRecords[dayRecords.length - 1] ?? null;
  const totals = {
    days: dayRecords.length,
    metricsTracked: metricCatalog.length,
    steps: round(dayRecords.reduce((total, day) => total + day.summary.steps, 0), 0),
    activeEnergy: round(dayRecords.reduce((total, day) => total + day.summary.activeEnergy, 0), 1),
    sleepHours: round(dayRecords.reduce((total, day) => total + day.summary.sleepHours, 0), 1),
  };

  const metricTrends = metricCatalog.map((metric) => ({
    ...metric,
    points: dayRecords
      .filter((day) => day.metricMap[metric.name])
      .map((day) => ({
        label: day.date.slice(5),
        value: day.metricMap[metric.name].keyMetric,
        unit: day.metricMap[metric.name].keyUnit,
      })),
  }));

  const recentOverview = createRecentOverview(dayRecords);
  const bodyMetrics = await readBodyMetricsDb(dbPath);
  const workoutRecords = await readWorkoutRecordsDb(dbPath);

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceDir: "json",
    latestDate: latest?.date ?? null,
    metricCatalog,
    metricTrends,
    recentOverview,
    bodyMetrics,
    workoutRecords,
    totals,
    days: dayRecords.map((day) => ({
      ...day,
      metricMap: undefined,
    })),
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(outputFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${outputFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
