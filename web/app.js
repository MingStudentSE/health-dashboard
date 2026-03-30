const dataUrl = "./data/health-dashboard.json";

const formatters = {
  integer: new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }),
  decimal: new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }),
  precise: new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }),
};

function formatNumber(value, digits = 0) {
  if (!Number.isFinite(Number(value))) return String(value ?? "--");
  if (digits === 0) return formatters.integer.format(value);
  if (digits === 1) return formatters.decimal.format(value);
  return formatters.precise.format(value);
}

function inferDigits(unit = "") {
  return ["km", "h"].includes(unit) ? 2 : unit === "%" || unit === "bpm" || unit === "kJ" ? 1 : 0;
}

function formatMetricValue(value, unit = "") {
  if (typeof value === "string") return value;
  return `${formatNumber(value, inferDigits(unit))}${unit ? ` ${unit}` : ""}`;
}

function metricTile(label, value, suffix = "") {
  return `
    <article class="metric-tile">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}${suffix ? `<small> ${suffix}</small>` : ""}</div>
    </article>
  `;
}

function createHeroStats(payload) {
  const stats = (payload.recentOverview?.hero || []).map((item) => [
    item.label,
    typeof item.value === "number" ? formatMetricValue(item.value, item.unit) : item.value,
  ]);

  document.querySelector("#hero-stats").innerHTML = stats
    .map(
      ([label, value]) => `
        <article class="stat-card">
          <div class="stat-label">${label}</div>
          <div class="stat-value">${value}</div>
        </article>
      `,
    )
    .join("");
}

function createBodySummary(payload) {
  const bodyMetrics = payload.bodyMetrics || {};
  const hero = Array.isArray(bodyMetrics.summary?.hero) ? bodyMetrics.summary.hero : [];
  const highlights = bodyMetrics.summary?.highlights || [];
  const recommendations = bodyMetrics.summary?.recommendations || [];

  document.querySelector("#body-summary-grid").innerHTML = hero.length
    ? hero
        .map((item) => {
          const formattedValue = typeof item.value === "number" ? formatMetricValue(item.value, item.unit) : item.value;
          const deltaText = item.delta && item.delta !== "持平" ? `${item.delta}${item.unit === "/100" ? "" : item.unit || ""}` : item.delta;
          return `
            <article class="metric-tile body-metric-tile">
              <div class="metric-label">${item.label}</div>
              <div class="metric-value">${formattedValue}</div>
              <div class="metric-delta">${deltaText || "首次记录"}</div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state compact">还没有身体数据记录，先去身体数据页添加第一条。</div>`;

  renderAnalysisList("#body-summary-highlights", highlights.length ? highlights : ["还没有形成身体数据判断。"]);
  renderAnalysisList(
    "#body-summary-recommendations",
    recommendations.length ? recommendations : ["建议先按周持续记录，趋势会比单次数值更有参考意义。"],
  );
}

function createWorkoutSummary(payload) {
  const workoutRecords = payload.workoutRecords || {};
  const hero = Array.isArray(workoutRecords.summary?.hero) ? workoutRecords.summary.hero : [];
  const highlights = workoutRecords.summary?.highlights || [];

  document.querySelector("#workout-summary-grid").innerHTML = hero.length
    ? hero
        .map((item) => {
          const formattedValue = typeof item.value === "number" ? formatMetricValue(item.value, item.unit) : item.value;
          return `
            <article class="metric-tile body-metric-tile">
              <div class="metric-label">${item.label}</div>
              <div class="metric-value">${formattedValue}</div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state compact">还没有训练记录，先去健身记录页添加第一堂训练。</div>`;

  renderAnalysisList("#workout-summary-highlights", highlights.length ? highlights : ["最近还没有可展示的训练摘要。"]);
}

function createRecentAnalysis(payload) {
  const recent = payload.recentOverview?.analysis;
  document.querySelector("#recent-analysis-title").textContent =
    recent?.title ?? "最近状态分析";
  document.querySelector("#recent-range-label").textContent =
    payload.recentOverview?.rangeLabel ?? "最近窗口";
  document.querySelector("#recent-analysis-summary").textContent =
    recent?.summary ?? "当前还没有足够的数据生成最近状态分析。";
  renderAnalysisList("#recent-finding-list", recent?.findings);
  renderAnalysisList("#recent-recommendation-list", recent?.recommendations);
  renderAnalysisList("#recent-caution-list", recent?.cautions);
}

function renderLineChart(targetId, points, color, unit = "") {
  const target = document.querySelector(targetId);
  if (!target) return;
  if (!points.length) {
    target.innerHTML = `<div class="empty-state">这一项当前还没有可展示的数据。</div>`;
    return;
  }

  const width = 420;
  const height = 180;
  const padding = 18;
  const numericValues = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  const maxValue = Math.max(...numericValues, 1);
  const minValue = Math.min(...numericValues, 0);
  const range = maxValue - minValue || 1;

  const coords = points.map((point, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
    const y = height - padding - ((point.value - minValue) / range) * (height - padding * 2);
    return { ...point, x, y };
  });

  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  target.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="chart">
      <defs>
        <linearGradient id="${targetId.replace("#", "")}-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35"></stop>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"></stop>
        </linearGradient>
      </defs>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(120,92,68,.15)" />
      <path d="${path} L ${coords.at(-1).x} ${height - padding} L ${coords[0].x} ${height - padding} Z" fill="url(#${targetId.replace("#", "")}-fill)"></path>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      ${coords
        .map(
          (point) =>
            `<circle cx="${point.x}" cy="${point.y}" r="4" fill="${color}" stroke="rgba(255,250,242,.95)" stroke-width="2"></circle>`,
        )
        .join("")}
    </svg>
    <div class="chart-caption">
      <span>${points[0].label}</span>
      <span>${formatMetricValue(points.at(-1).value, unit)}</span>
    </div>
  `;
}

function renderBarChart(targetId, points, color, unit = "") {
  const target = document.querySelector(targetId);
  if (!target) return;
  if (!points.length) {
    target.innerHTML = `<div class="empty-state">这一项当前还没有可展示的数据。</div>`;
    return;
  }

  const width = 420;
  const height = 180;
  const padding = 18;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const barWidth = (width - padding * 2) / points.length - 4;

  target.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="bar chart">
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(120,92,68,.15)" />
      ${points
        .map((point, index) => {
          const valueHeight = (point.value / maxValue) * (height - padding * 2);
          const x = padding + index * ((width - padding * 2) / points.length) + 2;
          const y = height - padding - valueHeight;
          return `<rect x="${x}" y="${y}" rx="8" ry="8" width="${Math.max(barWidth, 6)}" height="${valueHeight}" fill="${color}" opacity="${0.55 + (index / points.length) * 0.35}"></rect>`;
        })
        .join("")}
    </svg>
    <div class="chart-caption">
      <span>${points[0].label}</span>
      <span>${formatMetricValue(points.reduce((sum, item) => sum + item.value, 0), unit)}</span>
    </div>
  `;
}

function renderChart(targetId, chart, color) {
  if (!chart) return;
  if (chart.type === "line") {
    renderLineChart(targetId, chart.points, color, chart.unit);
    return;
  }
  renderBarChart(targetId, chart.points, color, chart.unit);
}

function createTrendCharts(payload) {
  const palette = ["#b55d3d", "#7b8b6f", "#7d5460", "#9b7a49", "#65829c", "#8a674f"];
  document.querySelector("#trend-grid").innerHTML = payload.metricTrends
    .filter((metric) => metric.points.length)
    .map(
      (metric, index) => `
        <article class="chart-card">
          <h3>${metric.label}</h3>
          <div class="svg-chart" id="trend-${metric.name}"></div>
        </article>
      `,
    )
    .join("");

  payload.metricTrends
    .filter((metric) => metric.points.length)
    .forEach((metric, index) => {
      renderLineChart(
        `#trend-${metric.name}`,
        metric.points.map((point) => ({ label: point.label, value: point.value })),
        palette[index % palette.length],
        metric.points[0]?.unit ?? "",
      );
    });
}

function calendarToneClass(day) {
  if (day.analysis.score >= 86) return "tone-good";
  if (day.analysis.score >= 74) return "tone-steady";
  if (day.analysis.score >= 60) return "tone-repair";
  return "tone-alert";
}

function openPreview(day, noteMeta) {
  const dialog = document.querySelector("#calendar-preview");
  document.querySelector("#preview-date").textContent = day.date;
  document.querySelector("#preview-summary").textContent = day.analysis.summary;
  document.querySelector("#preview-metrics").innerHTML = [
    metricTile("睡眠", formatNumber(day.summary.sleepHours, 1), "h"),
    metricTile("步数", formatNumber(day.summary.steps)),
    metricTile("心率", formatNumber(day.summary.heartRateAvg, 1), "bpm"),
    metricTile("日志状态", noteMeta?.hasJournal ? "已写" : "未写"),
  ].join("");
  document.querySelector("#preview-findings").innerHTML = (day.analysis.findings || [])
    .slice(0, 3)
    .map((item) => `<article class="insight-item">${item}</article>`)
    .join("");
  document.querySelector("#preview-open-link").href = `./daily.html?date=${day.date}`;
  if (typeof dialog.showModal === "function") dialog.showModal();
}

function createCalendar(days) {
  const notesMeta = window.__HEALTH_NOTES_META__ || {};
  const grouped = new Map();
  for (const day of days) {
    const monthKey = day.date.slice(0, 7);
    if (!grouped.has(monthKey)) grouped.set(monthKey, []);
    grouped.get(monthKey).push(day);
  }

  const monthNames = Array.from(grouped.keys()).sort().reverse();
  document.querySelector("#calendar-list").innerHTML = monthNames
    .map((monthKey) => {
      const monthDays = grouped.get(monthKey).slice().sort((a, b) => a.date.localeCompare(b.date));
      return `
        <section class="calendar-month">
          <div class="calendar-month-head">
            <h3>${monthKey}</h3>
            <span>${monthDays.length} 天</span>
          </div>
          <div class="calendar-grid">
            ${monthDays
              .map(
                (day) => `
                  <button
                    class="calendar-day ${calendarToneClass(day)} ${day.date === days.at(-1)?.date ? "is-latest" : ""} ${notesMeta[day.date]?.hasJournal ? "has-note" : "no-note"}"
                    type="button"
                    data-date="${day.date}"
                  >
                    <strong>${day.date.slice(8)}</strong>
                    <span>${day.analysis.tone}</span>
                    <small>${notesMeta[day.date]?.hasJournal ? "已写日志" : "未写日志"}</small>
                  </button>
                `,
              )
              .join("")}
          </div>
        </section>
      `;
    })
    .join("");

  document.querySelectorAll(".calendar-day").forEach((button) => {
    button.addEventListener("click", () => {
      const targetDay = days.find((day) => day.date === button.dataset.date);
      if (targetDay) openPreview(targetDay, notesMeta[targetDay.date]);
    });
  });
}

function renderAnalysisList(targetId, items) {
  document.querySelector(targetId).innerHTML = (items?.length ? items : ["暂无明确结论。"])
    .map((text) => `<article class="insight-item">${text}</article>`)
    .join("");
}


async function loadPayload() {
  if (window.__HEALTH_DASHBOARD_DATA__) return window.__HEALTH_DASHBOARD_DATA__;
  try {
    const apiResponse = await fetch("/api/dashboard");
    if (apiResponse.ok) return apiResponse.json();
  } catch {
    // Fall back to static JSON when not running via the local server.
  }
  const response = await fetch(dataUrl);
  return response.json();
}

async function main() {
  const payload = await loadPayload();
  window.__HEALTH_NOTES_META__ = payload.notesMeta || {};
  const days = payload.days ?? [];

  createHeroStats(payload);
  createBodySummary(payload);
  createWorkoutSummary(payload);
  createRecentAnalysis(payload);
  createTrendCharts(payload);
  createCalendar(days);
}

main().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main class="page-shell"><section class="paper-panel"><h1>数据加载失败</h1><p class="hero-text">请先运行 <code>npm run build:dashboard</code> 或 <code>npm run build:standalone</code>，再打开页面。</p></section></main>`;
});
