const dataUrl = "./data/health-dashboard.json";

const formatters = {
  integer: new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }),
  decimal: new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }),
  precise: new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }),
};

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(Number(value))) return "--";
  if (digits === 0) return formatters.integer.format(value);
  if (digits === 1) return formatters.decimal.format(value);
  return formatters.precise.format(value);
}

function inferDigits(unit = "") {
  return unit === "/100" ? 0 : unit === "%" ? 1 : unit === "kg" || unit === "cm" || unit === "岁" ? 1 : 1;
}

function formatMetricValue(value, unit = "") {
  if (!Number.isFinite(Number(value))) return "--";
  return `${formatNumber(value, inferDigits(unit))}${unit && unit !== "/100" ? ` ${unit}` : unit === "/100" ? unit : ""}`;
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
}

function renderAnalysisList(targetId, items, emptyText) {
  const target = document.querySelector(targetId);
  target.innerHTML = (items?.length ? items : [emptyText]).map((item) => `<article class="insight-item">${item}</article>`).join("");
}

function renderLineChart(targetId, points, color, unit = "") {
  const target = document.querySelector(targetId);
  if (!target) return;
  if (!points.length) {
    target.innerHTML = `<div class="empty-state">这一项暂时还没有足够的记录。</div>`;
    return;
  }

  const width = 420;
  const height = 180;
  const padding = 18;
  const values = points.map((point) => point.value).filter((value) => Number.isFinite(value));
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;

  const coords = points.map((point, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(points.length - 1, 1);
    const y = height - padding - ((point.value - minValue) / range) * (height - padding * 2);
    return { ...point, x, y };
  });

  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const gradientId = `${targetId.replace("#", "")}-fill`;

  target.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="trend chart">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35"></stop>
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02"></stop>
        </linearGradient>
      </defs>
      <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="rgba(120,92,68,.15)" />
      <path d="${path} L ${coords.at(-1).x} ${height - padding} L ${coords[0].x} ${height - padding} Z" fill="url(#${gradientId})"></path>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      ${coords.map((point) => `<circle class="chart-hit" data-label="${point.label}" data-value="${formatMetricValue(point.value, unit)}" cx="${point.x}" cy="${point.y}" r="12" fill="transparent"></circle><circle cx="${point.x}" cy="${point.y}" r="5" fill="${color}" stroke="rgba(255,250,242,.95)" stroke-width="2"></circle>`).join("")}
    </svg>
    <div class="chart-hover-tooltip" hidden></div>
    <div class="chart-caption">
      <span>${chartRangeLabel(points)}</span>
      <span>${formatMetricValue(points.at(-1).value, unit)}</span>
    </div>
  `;
  bindChartTooltip(target);
}

async function loadDashboard() {
  if (window.__HEALTH_DASHBOARD_DATA__) return window.__HEALTH_DASHBOARD_DATA__;
  try {
    const response = await fetch("/api/dashboard");
    if (response.ok) return response.json();
  } catch {
    // Fallback below.
  }
  const response = await fetch(dataUrl);
  return response.json();
}

async function loadBodyMetrics(payload) {
  try {
    const response = await fetch("/api/body-records");
    if (response.ok) return response.json();
  } catch {
    // Use prebuilt payload in static mode.
  }
  return payload.bodyMetrics || { records: [], summary: { hero: [], highlights: [], recommendations: [] }, trendSeries: [] };
}

function fillForm(record = null) {
  const form = document.querySelector("#body-record-form");
  form.elements.date.value = record?.date || new Date().toISOString().slice(0, 10);
  form.elements.weight.value = record?.weight ?? "";
  form.elements.bodyFatRate.value = record?.bodyFatRate ?? "";
  form.elements.skeletalMuscle.value = record?.skeletalMuscle ?? "";
  form.elements.chest.value = record?.chest ?? "";
  form.elements.waist.value = record?.waist ?? "";
  form.elements.hip.value = record?.hip ?? "";
  form.elements.bodyAge.value = record?.bodyAge ?? "";
  form.elements.score.value = record?.score ?? "";
  form.elements.note.value = record?.note ?? "";
}

function getBodyDialog() {
  return document.querySelector("#body-form-dialog");
}

function openBodyDialog(record = null) {
  const dialog = getBodyDialog();
  fillForm(record);
  document.querySelector("#body-dialog-title").textContent = record ? `编辑 ${record.date} 的记录` : "新增或更新一次记录";
  document.querySelector("#form-status").textContent = record
    ? `已载入 ${record.date}，保存后会覆盖这一天的数据。`
    : "填写完成后保存，这次身体记录会进入趋势与历史。";
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "open");
  }
}

function closeBodyDialog() {
  const dialog = getBodyDialog();
  if (dialog.open && typeof dialog.close === "function") {
    dialog.close();
    return;
  }
  dialog.removeAttribute("open");
}

function renderHero(bodyMetrics) {
  const hero = bodyMetrics.summary?.hero || [];
  document.querySelector("#body-hero-stats").innerHTML = hero.length
    ? hero
        .map(
          (item) => `
            <article class="stat-card">
              <div class="stat-label">${item.label}</div>
              <div class="stat-value">${formatMetricValue(item.value, item.unit)}</div>
              <div class="metric-delta">${item.delta || "首次记录"}</div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">还没有身体记录，先添加第一条数据。</div>`;
}

function renderSummary(bodyMetrics) {
  renderAnalysisList("#body-summary-list", bodyMetrics.summary?.highlights, "还没有身体数据判断。");
  renderAnalysisList(
    "#body-recommendation-list",
    bodyMetrics.summary?.recommendations,
    "建议先固定记录日期，后面再看连续趋势。",
  );
}

function renderTrends(bodyMetrics) {
  const palette = ["#2673cc", "#74bded", "#8fcaf0", "#9edcc7", "#f7d77b", "#4d7fb0", "#5ea8cf", "#89bfd9"];
  const series = (bodyMetrics.trendSeries || []).filter((item) => item.points.length);
  document.querySelector("#body-trend-grid").innerHTML = series.length
    ? series
        .map(
          (seriesItem) => `
            <article class="chart-card">
              <h3>${seriesItem.label}</h3>
              <div class="svg-chart" id="trend-${seriesItem.field}"></div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">至少需要一条记录才能展示趋势。</div>`;

  series.forEach((seriesItem, index) => {
    renderLineChart(`#trend-${seriesItem.field}`, seriesItem.points, palette[index % palette.length], seriesItem.unit);
  });
}

function renderHistory(bodyMetrics) {
  const records = bodyMetrics.records || [];
  const target = document.querySelector("#body-history-list");
  target.innerHTML = records.length
    ? records
        .slice()
        .reverse()
        .map((record) => {
          const note = record.note ? `<p class="body-record-note">${record.note}</p>` : "";
          return `
            <article class="body-record-card">
              <div class="body-record-head">
                <div>
                  <div class="body-record-date">${record.date}</div>
                  <div class="subtle-text">${record.analysis?.summary || "这次记录已保存。"}</div>
                </div>
                <div class="body-record-actions">
                  <button class="ghost-button" type="button" data-edit-date="${record.date}">编辑</button>
                  <button class="danger-button" type="button" data-delete-date="${record.date}">删除</button>
                </div>
              </div>
              <div class="body-record-grid">
                ${(record.cards || [])
                  .map(
                    (card) => `
                      <article class="metric-tile">
                        <div class="metric-label">${card.label}</div>
                        <div class="metric-value">${formatMetricValue(card.value, card.unit)}</div>
                        <div class="metric-delta">${card.delta || "首次记录"}</div>
                      </article>
                    `,
                  )
                  .join("")}
              </div>
              ${note}
              <div class="body-record-analysis">
                ${(record.analysis?.findings || []).map((item) => `<article class="insight-item">${item}</article>`).join("")}
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">还没有历史记录，先保存第一条。</div>`;
}

async function saveRecord() {
  const form = document.querySelector("#body-record-form");
  const date = form.elements.date.value;
  const status = document.querySelector("#form-status");
  const payload = {
    weight: form.elements.weight.value,
    bodyFatRate: form.elements.bodyFatRate.value,
    skeletalMuscle: form.elements.skeletalMuscle.value,
    chest: form.elements.chest.value,
    waist: form.elements.waist.value,
    hip: form.elements.hip.value,
    bodyAge: form.elements.bodyAge.value,
    score: form.elements.score.value,
    note: form.elements.note.value,
  };

  const response = await fetch(`/api/body-records/${date}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "保存失败");
  }

  const bodyMetrics = await response.json();
  status.textContent = `已保存 ${date} 的身体数据。`;
  return bodyMetrics;
}

async function deleteRecord(date) {
  const response = await fetch(`/api/body-records/${date}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "删除失败");
  }
  return response.json();
}

function bindActions(state) {
  const bodyDialog = getBodyDialog();

  document.querySelector("#open-body-dialog-button").addEventListener("click", () => {
    openBodyDialog();
  });

  document.querySelector("#close-body-dialog-button").addEventListener("click", () => {
    closeBodyDialog();
  });

  bodyDialog.addEventListener("click", (event) => {
    if (event.target === bodyDialog) closeBodyDialog();
  });

  document.querySelector("#reset-record-button").addEventListener("click", () => {
    fillForm();
    document.querySelector("#body-dialog-title").textContent = "新增或更新一次记录";
    document.querySelector("#form-status").textContent = "表单已重置。";
  });

  document.querySelector("#body-record-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#form-status");
    status.textContent = "正在保存...";
    try {
      state.bodyMetrics = await saveRecord();
      renderAll(state.bodyMetrics);
      document.querySelector("#body-dialog-title").textContent = "新增或更新一次记录";
      closeBodyDialog();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  document.querySelector("#body-history-list").addEventListener("click", async (event) => {
    const editDate = event.target.closest("[data-edit-date]")?.dataset.editDate;
    if (editDate) {
      const record = (state.bodyMetrics.records || []).find((item) => item.date === editDate);
      openBodyDialog(record);
      return;
    }

    const deleteDate = event.target.closest("[data-delete-date]")?.dataset.deleteDate;
    if (deleteDate) {
      if (!window.confirm(`确认删除 ${deleteDate} 的身体记录吗？`)) return;
      try {
        state.bodyMetrics = await deleteRecord(deleteDate);
        renderAll(state.bodyMetrics);
        document.querySelector("#form-status").textContent = `已删除 ${deleteDate} 的记录。`;
      } catch (error) {
        document.querySelector("#form-status").textContent = error.message;
      }
    }
  });
}

function renderAll(bodyMetrics) {
  renderHero(bodyMetrics);
  renderSummary(bodyMetrics);
  renderTrends(bodyMetrics);
  renderHistory(bodyMetrics);
}

async function main() {
  const payload = await loadDashboard();
  const bodyMetrics = await loadBodyMetrics(payload);
  const state = { bodyMetrics };
  fillForm(bodyMetrics.latestRecord);
  renderAll(bodyMetrics);
  bindActions(state);
}

main().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main class="page-shell"><section class="paper-panel"><h1>身体数据页加载失败</h1><p class="hero-text">${error.message}</p></section></main>`;
});
