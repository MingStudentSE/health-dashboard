const dataUrl = "./data/health-dashboard.json";

const formatters = {
  integer: new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }),
  decimal: new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }),
};

function formatValue(value, unit = "") {
  if (!Number.isFinite(Number(value))) return "--";
  const formatted = unit === "kg" ? formatters.decimal.format(value) : formatters.integer.format(value);
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function renderAnalysisList(targetId, items, emptyText) {
  const target = document.querySelector(targetId);
  target.innerHTML = (items?.length ? items : [emptyText]).map((item) => `<article class="insight-item">${item}</article>`).join("");
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

async function loadWorkoutPayload(payload) {
  try {
    const response = await fetch("/api/workout-records");
    if (response.ok) return response.json();
  } catch {
    // Use static payload in standalone mode.
  }
  return payload.workoutRecords || { records: [], summary: { hero: [], highlights: [] } };
}

function createSetRow(set = {}) {
  const template = document.querySelector("#set-template");
  const fragment = template.content.firstElementChild.cloneNode(true);
  fragment.querySelector("[data-set-reps]").value = set.reps ?? "";
  fragment.querySelector("[data-set-weight]").value = set.weight ?? "";
  return fragment;
}

function createExerciseCard(exercise = {}) {
  const template = document.querySelector("#exercise-template");
  const card = template.content.firstElementChild.cloneNode(true);
  card.querySelector("[data-exercise-name]").value = exercise.name ?? "";
  card.querySelector("[data-exercise-targets]").value = exercise.targetAreas ?? "";
  const setList = card.querySelector(".set-list");
  const sets = Array.isArray(exercise.sets) && exercise.sets.length ? exercise.sets : [{ reps: "", weight: "" }];
  sets.forEach((setItem) => setList.appendChild(createSetRow(setItem)));
  return card;
}

function renderExerciseList(exercises = []) {
  const list = document.querySelector("#exercise-list");
  list.innerHTML = "";
  if (!exercises.length) {
    list.appendChild(createExerciseCard());
    return;
  }
  exercises.forEach((exercise) => list.appendChild(createExerciseCard(exercise)));
}

function fillForm(record = null) {
  const form = document.querySelector("#workout-record-form");
  form.dataset.recordId = record?.id || "";
  form.elements.date.value = record?.date || new Date().toISOString().slice(0, 10);
  form.elements.coachEvaluation.value = record?.coachEvaluation || "";
  form.elements.personalFeedback.value = record?.personalFeedback || "";
  renderExerciseList(record?.exercises || []);
}

function collectExercises() {
  return Array.from(document.querySelectorAll(".exercise-card"))
    .map((card) => ({
      name: card.querySelector("[data-exercise-name]").value,
      targetAreas: card.querySelector("[data-exercise-targets]").value,
      sets: Array.from(card.querySelectorAll(".set-row")).map((row) => ({
        reps: row.querySelector("[data-set-reps]").value,
        weight: row.querySelector("[data-set-weight]").value,
      })),
    }))
    .filter((exercise) => exercise.name || exercise.targetAreas || exercise.sets.some((setItem) => setItem.reps || setItem.weight));
}

function renderHero(payload) {
  const hero = payload.summary?.hero || [];
  document.querySelector("#workout-hero-stats").innerHTML = hero.length
    ? hero
        .map(
          (item) => `
            <article class="stat-card">
              <div class="stat-label">${item.label}</div>
              <div class="stat-value">${typeof item.value === "number" ? formatValue(item.value, item.unit) : item.value}</div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">还没有训练记录，先添加第一堂训练。</div>`;
}

function renderSummary(payload) {
  renderAnalysisList("#workout-summary-list", payload.summary?.highlights, "还没有训练摘要。");
}

function renderHistory(payload) {
  const records = payload.records || [];
  const target = document.querySelector("#workout-history-list");
  target.innerHTML = records.length
    ? records
        .slice()
        .reverse()
        .map((record) => `
          <article class="body-record-card">
            <div class="body-record-head">
              <div>
                <div class="body-record-date">${record.date}</div>
                <div class="subtle-text">${(record.summary?.targetAreas || []).join("、") || "未填写目标部位"}</div>
              </div>
              <div class="body-record-actions">
                <button class="ghost-button" type="button" data-edit-id="${record.id}">编辑</button>
                <button class="danger-button" type="button" data-delete-id="${record.id}">删除</button>
              </div>
            </div>
            <div class="body-record-grid">
              <article class="metric-tile">
                <div class="metric-label">动作数</div>
                <div class="metric-value">${formatValue(record.summary?.exerciseCount ?? 0)}</div>
              </article>
              <article class="metric-tile">
                <div class="metric-label">总组数</div>
                <div class="metric-value">${formatValue(record.summary?.totalSets ?? 0)}</div>
              </article>
              <article class="metric-tile">
                <div class="metric-label">训练容量</div>
                <div class="metric-value">${formatValue(Math.round(record.summary?.totalVolume ?? 0), "kg")}</div>
              </article>
            </div>
            <div class="exercise-history-list">
              ${(record.exercises || [])
                .map(
                  (exercise) => `
                    <article class="exercise-history-card">
                      <strong>${exercise.name || "未命名动作"}</strong>
                      <span>${exercise.targetAreas || "未填写目标部位"}</span>
                      <div class="subtle-text">
                        ${(exercise.sets || [])
                          .map((setItem, index) => `第 ${index + 1} 组：${setItem.reps || "--"} 次 × ${setItem.weight || "--"} kg`)
                          .join("； ")}
                      </div>
                    </article>
                  `,
                )
                .join("")}
            </div>
            ${record.coachEvaluation ? `<p class="body-record-note"><strong>教练评价：</strong>${record.coachEvaluation}</p>` : ""}
            ${record.personalFeedback ? `<p class="body-record-note"><strong>个人反馈：</strong>${record.personalFeedback}</p>` : ""}
          </article>
        `)
        .join("")
    : `<div class="empty-state">还没有历史训练记录。</div>`;
}

function renderAll(payload) {
  renderHero(payload);
  renderSummary(payload);
  renderHistory(payload);
}

async function saveRecord() {
  const form = document.querySelector("#workout-record-form");
  const payload = {
    id: form.dataset.recordId || undefined,
    date: form.elements.date.value,
    coachEvaluation: form.elements.coachEvaluation.value,
    personalFeedback: form.elements.personalFeedback.value,
    exercises: collectExercises(),
  };

  const isEditing = Boolean(form.dataset.recordId);
  const response = await fetch(isEditing ? `/api/workout-records/${encodeURIComponent(form.dataset.recordId)}` : "/api/workout-records", {
    method: isEditing ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "保存失败");
  }

  return response.json();
}

async function deleteRecord(id) {
  const response = await fetch(`/api/workout-records/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "删除失败");
  }
  return response.json();
}

function bindActions(state) {
  document.querySelector("#add-exercise-button").addEventListener("click", () => {
    document.querySelector("#exercise-list").appendChild(createExerciseCard());
  });

  document.querySelector("#exercise-list").addEventListener("click", (event) => {
    const card = event.target.closest(".exercise-card");
    if (!card) return;

    if (event.target.closest("[data-remove-exercise]")) {
      card.remove();
      if (!document.querySelectorAll(".exercise-card").length) renderExerciseList([]);
      return;
    }

    if (event.target.closest("[data-add-set]")) {
      card.querySelector(".set-list").appendChild(createSetRow());
      return;
    }

    const setRow = event.target.closest(".set-row");
    if (setRow && event.target.closest("[data-remove-set]")) {
      setRow.remove();
      if (!card.querySelectorAll(".set-row").length) card.querySelector(".set-list").appendChild(createSetRow());
    }
  });

  document.querySelector("#reset-workout-button").addEventListener("click", () => {
    fillForm();
    document.querySelector("#workout-form-status").textContent = "表单已重置。";
  });

  document.querySelector("#workout-record-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#workout-form-status");
    status.textContent = "正在保存...";
    try {
      state.payload = await saveRecord();
      renderAll(state.payload);
      fillForm();
      status.textContent = "训练记录已保存。";
    } catch (error) {
      status.textContent = error.message;
    }
  });

  document.querySelector("#workout-history-list").addEventListener("click", async (event) => {
    const editId = event.target.closest("[data-edit-id]")?.dataset.editId;
    if (editId) {
      const record = (state.payload.records || []).find((item) => item.id === editId);
      fillForm(record);
      document.querySelector("#workout-form-status").textContent = "已载入历史训练，保存后会覆盖这条记录。";
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const deleteId = event.target.closest("[data-delete-id]")?.dataset.deleteId;
    if (deleteId) {
      if (!window.confirm("确认删除这条训练记录吗？")) return;
      try {
        state.payload = await deleteRecord(deleteId);
        renderAll(state.payload);
        document.querySelector("#workout-form-status").textContent = "训练记录已删除。";
      } catch (error) {
        document.querySelector("#workout-form-status").textContent = error.message;
      }
    }
  });
}

async function main() {
  const dashboard = await loadDashboard();
  const payload = await loadWorkoutPayload(dashboard);
  const state = { payload };
  renderAll(payload);
  fillForm();
  bindActions(state);
}

main().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main class="page-shell"><section class="paper-panel"><h1>健身记录页加载失败</h1><p class="hero-text">${error.message}</p></section></main>`;
});
