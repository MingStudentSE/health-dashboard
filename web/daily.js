const dashboardUrl = "./data/health-dashboard.json";

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

function chartRangeLabel(points) {
  if (!points.length) return "--";
  if (points.length === 1) return `仅 ${points[0].label}`;
  return `${points[0].label} 至 ${points.at(-1).label} · ${points.length} 天`;
}

function bindChartTooltip(target) {
  const tooltip = target.querySelector(".chart-hover-tooltip");
  if (!tooltip) return;

  const hideTooltip = () => {
    tooltip.hidden = true;
  };

  target.onpointermove = (event) => {
    const hit = event.target.closest(".chart-hit");
    if (!hit || !target.contains(hit)) {
      hideTooltip();
      return;
    }

    const rect = target.getBoundingClientRect();
    tooltip.innerHTML = `<strong>${hit.dataset.label}</strong><span>${hit.dataset.value}</span>`;
    tooltip.style.left = `${Math.min(Math.max(event.clientX - rect.left, 18), rect.width - 18)}px`;
    tooltip.style.top = `${Math.max(event.clientY - rect.top - 14, 18)}px`;
    tooltip.hidden = false;
  };

  target.onpointerleave = hideTooltip;
  target.onpointerup = hideTooltip;
  target.onpointercancel = hideTooltip;
  target.onpointerdown = target.onpointermove;
  target.onlostpointercapture = hideTooltip;
  target.addEventListener("scroll", hideTooltip, { passive: true });
  window.addEventListener("blur", hideTooltip);
}

function metricTile(label, value, suffix = "") {
  return `
    <article class="metric-tile">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}${suffix ? `<small> ${suffix}</small>` : ""}</div>
    </article>
  `;
}

function renderAnalysisList(items) {
  return (items?.length ? items : ["暂无明确内容。"])
    .map((text) => `<article class="insight-item">${text}</article>`)
    .join("");
}

function renderLineChart(target, points, color, unit = "") {
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
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="line chart">
      <defs>
        <linearGradient id="${target.id}-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35"></stop>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"></stop>
        </linearGradient>
      </defs>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(120,92,68,.15)" />
      <path d="${path} L ${coords.at(-1).x} ${height - padding} L ${coords[0].x} ${height - padding} Z" fill="url(#${target.id}-fill)"></path>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      ${coords
        .map((point) => `<circle class="chart-hit" data-label="${point.label}" data-value="${formatMetricValue(point.value, unit)}" cx="${point.x}" cy="${point.y}" r="12" fill="transparent"></circle><circle cx="${point.x}" cy="${point.y}" r="5" fill="${color}" stroke="rgba(255,250,242,.95)" stroke-width="2"></circle>`)
        .join("")}
    </svg>
    <div class="chart-hover-tooltip" hidden></div>
    <div class="chart-caption">
      <span>${chartRangeLabel(points)}</span>
      <span>${formatMetricValue(points.at(-1).value, unit)}</span>
    </div>
  `;
  bindChartTooltip(target);
}

function renderBarChart(target, points, color, unit = "") {
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
          return `<rect class="chart-hit" data-label="${point.label}" data-value="${formatMetricValue(point.value, unit)}" x="${x}" y="${y}" rx="8" ry="8" width="${Math.max(barWidth, 6)}" height="${valueHeight}" fill="${color}" opacity="${0.55 + (index / points.length) * 0.35}"></rect>`;
        })
        .join("")}
    </svg>
    <div class="chart-hover-tooltip" hidden></div>
    <div class="chart-caption">
      <span>${chartRangeLabel(points)}</span>
      <span>${formatMetricValue(points.reduce((sum, item) => sum + item.value, 0), unit)}</span>
    </div>
  `;
  bindChartTooltip(target);
}

function renderChart(target, chart, color) {
  if (chart.type === "line") return renderLineChart(target, chart.points, color, chart.unit);
  return renderBarChart(target, chart.points, color, chart.unit);
}

async function loadDashboard() {
  const response = await fetch(dashboardUrl);
  return response.json();
}

async function loadNote(date) {
  const response = await fetch(`/api/days/${date}/note`);
  return response.json();
}

async function saveNote(date, journal) {
  const response = await fetch(`/api/days/${date}/note`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ journal }),
  });
  return response.json();
}

async function generateFeedback(date) {
  const response = await fetch(`/api/days/${date}/feedback`, { method: "POST" });
  const payload = await response.json();
  if (!response.ok && payload.fallback) return payload.fallback;
  if (!response.ok) throw new Error(payload.error || "Failed to generate feedback.");
  return payload;
}

function renderFeedback(payload) {
  const container = document.querySelector("#generated-feedback");
  container.innerHTML = `
    <article class="feedback-card">
      <h3>${payload.title || "每日反馈"}</h3>
      <p class="analysis-summary">${payload.summary || ""}</p>
      <div class="analysis-block">
        <h4>日志回应</h4>
        <article class="insight-item">${payload.reflection || "暂无回应。"}</article>
      </div>
      <div class="analysis-block">
        <h4>今天做得不错</h4>
        <div class="insight-list">${renderAnalysisList(payload.wins)}</div>
      </div>
      <div class="analysis-block">
        <h4>明天的建议</h4>
        <div class="insight-list">${renderAnalysisList(payload.suggestions)}</div>
      </div>
      <div class="analysis-block">
        <h4>继续留意</h4>
        <div class="insight-list">${renderAnalysisList(payload.watchouts)}</div>
      </div>
      <p class="helper-text">反馈来源：${payload.source || "unknown"}${payload.generatedAt ? ` · ${payload.generatedAt}` : ""}</p>
    </article>
  `;
}

function renderDay(day) {
  document.querySelector("#daily-page-title").textContent = `${day.date} 的每日反馈页`;
  document.querySelector("#daily-analysis-tone").textContent = day.analysis.tone;
  document.querySelector("#daily-analysis-score").innerHTML = `<strong>${day.analysis.score}</strong><span>/ 100</span>`;
  document.querySelector("#daily-analysis-summary").textContent = day.analysis.summary;
  document.querySelector("#daily-finding-list").innerHTML = renderAnalysisList(day.analysis.findings);
  document.querySelector("#daily-recommendation-list").innerHTML = renderAnalysisList(day.analysis.recommendations);
  document.querySelector("#daily-caution-list").innerHTML = renderAnalysisList(day.analysis.cautions);

  document.querySelector("#daily-hero-stats").innerHTML = [
    ["指标覆盖", `${day.completeness.metricCount}/${day.completeness.universeCount}`],
    ["覆盖率", `${formatNumber(day.completeness.coveragePercent)}%`],
    ["睡眠", `${formatNumber(day.summary.sleepHours, 1)} h`],
    ["步数", formatNumber(day.summary.steps)],
    ["平均心率", `${formatNumber(day.summary.heartRateAvg, 1)} bpm`],
    ["活跃能量", `${formatNumber(day.summary.activeEnergy, 1)} kJ`],
  ]
    .map(([label, value]) => `<article class="stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></article>`)
    .join("");

  document.querySelector("#daily-detail-metrics").innerHTML = [
    metricTile("基础能量", formatNumber(day.summary.basalEnergy, 1), "kJ"),
    metricTile("步行距离", formatNumber(day.summary.distance, 2), "km"),
    metricTile("最高心率", formatNumber(day.summary.heartRateMax), "bpm"),
  ].join("");

  document.querySelector("#daily-metric-coverage").innerHTML = day.metrics
    .map((metric) => `<article class="coverage-chip"><strong>${metric.label}</strong><span>${metric.sampleCount} 条</span></article>`)
    .join("");

  const palette = ["#2673cc", "#74bded", "#8fcaf0", "#9edcc7", "#f7d77b", "#4d7fb0"];
  const container = document.querySelector("#daily-metric-panels");
  container.innerHTML = day.metrics
    .map(
      (metric) => `
        <article class="metric-panel">
          <div class="metric-panel-head">
            <div>
              <p class="section-kicker">${metric.sampleCount} 条样本</p>
              <h3>${metric.label}</h3>
            </div>
            <div class="metric-highlight">${formatMetricValue(metric.keyMetric, metric.keyUnit)}</div>
          </div>
          <div class="metric-card-grid">
            ${metric.cards.map((item) => metricTile(item.label, formatMetricValue(item.value, item.unit))).join("")}
          </div>
          ${
            metric.charts?.length
              ? metric.charts
                  .map(
                    (chart) => `
                      <div class="metric-chart-block">
                        <h4>${chart.title}</h4>
                        <div class="svg-chart metric-chart" id="daily-chart-${metric.name}-${chart.id}"></div>
                      </div>
                    `,
                  )
                  .join("")
              : `<div class="empty-state compact">这一项当前没有可视化分布可展示。</div>`
          }
          <div class="metric-insights">${renderAnalysisList(metric.insights)}</div>
        </article>
      `,
    )
    .join("");

  day.metrics.forEach((metric, metricIndex) => {
    metric.charts?.forEach((chart, chartIndex) => {
      const target = document.querySelector(`#daily-chart-${metric.name}-${chart.id}`);
      if (target) renderChart(target, chart, palette[(metricIndex + chartIndex) % palette.length]);
    });
  });
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const date = params.get("date");
  if (!date) {
    document.body.innerHTML = `<main class="page-shell"><section class="paper-panel"><h1>缺少日期参数</h1><p class="hero-text">请从首页进入某一天的专属页面。</p></section></main>`;
    return;
  }

  const dashboard = await loadDashboard();
  const day = (dashboard.days || []).find((item) => item.date === date);
  if (!day) {
    document.body.innerHTML = `<main class="page-shell"><section class="paper-panel"><h1>找不到这一天的数据</h1><p class="hero-text">当前数据集中没有 ${date} 的记录。</p></section></main>`;
    return;
  }

  renderDay(day);

  const note = await loadNote(date);
  const input = document.querySelector("#journal-input");
  const status = document.querySelector("#journal-status");
  input.value = note.journal || "";
  status.textContent = note.updatedAt ? `上次保存：${note.updatedAt}` : "日志尚未保存。";

  document.querySelector("#save-note-button").addEventListener("click", async () => {
    status.textContent = "正在保存日志...";
    const saved = await saveNote(date, input.value);
    status.textContent = `已保存：${saved.updatedAt}`;
  });

  document.querySelector("#generate-feedback-button").addEventListener("click", async () => {
    status.textContent = "正在生成反馈...";
    const feedback = await generateFeedback(date);
    renderFeedback(feedback);
    status.textContent = "反馈已生成。";
  });
}

main().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main class="page-shell"><section class="paper-panel"><h1>页面载入失败</h1><p class="hero-text">${error.message}</p></section></main>`;
});
