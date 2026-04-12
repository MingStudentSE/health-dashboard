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

  const moveTooltip = (event) => {
    const hit = event.target.closest(".chart-hit");
    if (!hit || !target.contains(hit)) {
      hideTooltip();
      return;
    }

    const rect = target.getBoundingClientRect();
    const left = Math.min(Math.max(event.clientX - rect.left, 18), rect.width - 18);
    const top = Math.max(event.clientY - rect.top - 14, 18);
    tooltip.innerHTML = `<strong>${hit.dataset.label}</strong><span>${hit.dataset.value}</span>`;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.hidden = false;
  };

  target.onpointermove = moveTooltip;
  target.onpointerleave = hideTooltip;
  target.onpointerup = hideTooltip;
  target.onpointercancel = hideTooltip;
  target.onpointerdown = moveTooltip;
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

function createHeroStats(payload) {
  const stats = (payload.recentOverview?.hero || []).map((item) => [
    item.label,
    typeof item.value === "number" ? formatMetricValue(item.value, item.unit) : item.value,
  ]);

  document.querySelector("#hero-stats").innerHTML = stats
    .map(
      ([label, value]) => `
        <article class="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <div class="text-xs text-gray-500 uppercase tracking-wide font-medium">${label}</div>
          <div class="text-xl font-bold text-gray-900 mt-1">${value}</div>
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
            `<circle class="chart-hit" data-label="${point.label}" data-value="${formatMetricValue(point.value, unit)}" cx="${point.x}" cy="${point.y}" r="12" fill="transparent"></circle><circle cx="${point.x}" cy="${point.y}" r="5" fill="${color}" stroke="rgba(255,250,242,.95)" stroke-width="2"></circle>`,
        )
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

function renderChart(targetId, chart, color) {
  if (!chart) return;
  if (chart.type === "line") {
    renderLineChart(targetId, chart.points, color, chart.unit);
    return;
  }
  renderBarChart(targetId, chart.points, color, chart.unit);
}

function createTrendCharts(payload) {
  const palette = ["#2673cc", "#74bded", "#8fcaf0", "#9edcc7", "#f7d77b", "#4d7fb0"];
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

function setLatestDailyLink(days) {
  const link = document.querySelector("#latest-daily-link");
  if (!link) return;
  const latestDay = (days || []).slice().sort((left, right) => left.date.localeCompare(right.date)).at(-1);
  if (!latestDay) {
    link.href = "./daily.html";
    return;
  }
  link.href = `./daily.html?date=${latestDay.date}`;
}

function calendarToneClass(day) {
  if (day.analysis.score >= 86) return "tone-good";
  if (day.analysis.score >= 74) return "tone-steady";
  if (day.analysis.score >= 60) return "tone-repair";
  return "tone-alert";
}

function reportHeatLevel(day) {
  if (!day) return 0;
  if (day.analysis.score >= 86) return 1;
  if (day.analysis.score >= 74) return 2;
  if (day.analysis.score >= 60) return 3;
  return 4;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function monthLabel(year, month) {
  return `${year}年${month}月`;
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
  const target = document.querySelector("#calendar-list");
  const pickerTrigger = document.querySelector("#calendar-picker-trigger");
  const pickerDialog = document.querySelector("#calendar-picker-dialog");
  const pickerTitle = document.querySelector("#calendar-picker-title");
  const pickerClose = document.querySelector("#calendar-picker-close");
  const yearSelect = document.querySelector("#calendar-year-select");
  const monthSelect = document.querySelector("#calendar-month-select");
  const prevButton = document.querySelector("#calendar-prev-month");
  const nextButton = document.querySelector("#calendar-next-month");
  const meta = document.querySelector("#calendar-meta");

  const dayMap = new Map(days.map((day) => [day.date, day]));
  const sortedDates = days.map((day) => day.date).sort();

  if (!sortedDates.length) {
    target.innerHTML = `<div class="calendar-empty-state">还没有可展示的报告日历，先同步几天数据后这里就会出现单月日历。</div>`;
    meta.textContent = "";
    pickerTrigger.textContent = "暂无报告";
    pickerTrigger.disabled = true;
    yearSelect.innerHTML = "";
    monthSelect.innerHTML = "";
    prevButton.disabled = true;
    nextButton.disabled = true;
    return;
  }

  const latestDate = sortedDates.at(-1);
  const firstDay = new Date(`${sortedDates[0]}T00:00:00`);
  const lastDay = new Date(`${latestDate}T00:00:00`);
  const availableYears = [];
  for (let year = firstDay.getFullYear(); year <= lastDay.getFullYear(); year += 1) {
    availableYears.push(year);
  }

  const availableMonths = Array.from({ length: 12 }, (_, index) => index + 1);
  const state = {
    year: lastDay.getFullYear(),
    month: lastDay.getMonth() + 1,
  };

  yearSelect.innerHTML = availableYears.map((year) => `<option value="${year}">${year} 年</option>`).join("");
  monthSelect.innerHTML = availableMonths.map((month) => `<option value="${month}">${month} 月</option>`).join("");

  function renderCalendar() {
    const firstVisibleDay = new Date(state.year, state.month - 1, 1);
    const lastVisibleDay = new Date(state.year, state.month, 0);
    const firstDayOffset = firstVisibleDay.getDay();
    const monthKey = `${state.year}-${pad2(state.month)}`;
    const monthDays = days.filter((day) => day.date.startsWith(monthKey));

    const cells = [];
    for (let i = 0; i < firstDayOffset; i += 1) {
      cells.push('<div class="calendar-day calendar-empty" aria-hidden="true"></div>');
    }

    const current = new Date(firstVisibleDay);
    while (current <= lastVisibleDay) {
      const dateKey = `${current.getFullYear()}-${pad2(current.getMonth() + 1)}-${pad2(current.getDate())}`;
      const day = dayMap.get(dateKey);
      if (day) {
        const heatLevel = reportHeatLevel(day);
        cells.push(`
          <button
            class="report-calendar-day heat-${heatLevel} ${dateKey === latestDate ? "is-latest" : ""}"
            type="button"
            data-date="${day.date}"
            title="${day.date} · ${day.analysis.tone}"
          >
            <strong>${current.getDate()}</strong>
          </button>
        `);
      } else {
        cells.push(`
          <div class="report-calendar-day is-empty" aria-label="${dateKey}">
            <strong>${current.getDate()}</strong>
          </div>
        `);
      }
      current.setDate(current.getDate() + 1);
    }

    target.innerHTML = `
      <section class="calendar-month">
        <div class="calendar-month-head">
          <strong>${monthLabel(state.year, state.month)}</strong>
          <span>${monthDays.length} 天有报告</span>
        </div>
        <div class="calendar-weekdays">
          <div class="calendar-weekday">日</div>
          <div class="calendar-weekday">一</div>
          <div class="calendar-weekday">二</div>
          <div class="calendar-weekday">三</div>
          <div class="calendar-weekday">四</div>
          <div class="calendar-weekday">五</div>
          <div class="calendar-weekday">六</div>
        </div>
        <div class="calendar-grid report-calendar-grid">${cells.join("")}</div>
      </section>
    `;

    pickerTrigger.textContent = monthLabel(state.year, state.month);
    pickerTitle.textContent = `切换到 ${monthLabel(state.year, state.month)}`;
    meta.textContent = `${monthLabel(state.year, state.month)} · ${monthDays.length} 天有报告`;
    prevButton.disabled = state.year === availableYears[0] && state.month === 1;
    nextButton.disabled = state.year === availableYears.at(-1) && state.month === 12;
  }

  yearSelect.value = String(state.year);
  monthSelect.value = String(state.month);

  yearSelect.addEventListener("change", () => {
    state.year = Number(yearSelect.value);
    renderCalendar();
  });

  monthSelect.addEventListener("change", () => {
    state.month = Number(monthSelect.value);
    renderCalendar();
  });

  prevButton.addEventListener("click", () => {
    if (state.month === 1) {
      if (state.year > availableYears[0]) {
        state.month = 12;
        state.year -= 1;
      }
    } else {
      state.month -= 1;
    }
    yearSelect.value = String(state.year);
    monthSelect.value = String(state.month);
    renderCalendar();
  });

  nextButton.addEventListener("click", () => {
    if (state.month === 12) {
      if (state.year < availableYears.at(-1)) {
        state.month = 1;
        state.year += 1;
      }
    } else {
      state.month += 1;
    }
    yearSelect.value = String(state.year);
    monthSelect.value = String(state.month);
    renderCalendar();
  });

  target.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    const targetDay = dayMap.get(button.dataset.date);
    if (targetDay) openPreview(targetDay, notesMeta[targetDay.date]);
  });

  pickerTrigger.addEventListener("click", () => {
    if (typeof pickerDialog.showModal === "function") {
      pickerDialog.showModal();
    } else {
      pickerDialog.setAttribute("open", "open");
    }
  });

  pickerClose.addEventListener("click", () => {
    if (pickerDialog.open && typeof pickerDialog.close === "function") {
      pickerDialog.close();
    } else {
      pickerDialog.removeAttribute("open");
    }
  });

  pickerDialog.addEventListener("click", (event) => {
    if (event.target === pickerDialog) {
      if (pickerDialog.open && typeof pickerDialog.close === "function") {
        pickerDialog.close();
      } else {
        pickerDialog.removeAttribute("open");
      }
    }
  });

  renderCalendar();
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
  setLatestDailyLink(days);
  createCalendar(days);
}

main().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main class="page-shell"><section class="paper-panel"><h1>数据加载失败</h1><p class="hero-text">请先运行 <code>npm run build:dashboard</code> 或 <code>npm run build:standalone</code>，再打开页面。</p></section></main>`;
});
