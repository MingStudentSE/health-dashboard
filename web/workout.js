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

function renderAreaChips(areas = [], emptyText = "未填写训练部位") {
  if (!areas.length) return `<div class="subtle-text">${emptyText}</div>`;
  return `
    <div class="coverage-strip">
      ${areas.map((area) => `<span class="coverage-chip"><strong>${area}</strong></span>`).join("")}
    </div>
  `;
}

function parseWorkoutDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function monthKeyForDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthTitle(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatDayLabel(dateString) {
  const date = parseWorkoutDate(dateString);
  return `${date.getDate()}日`;
}

function dateKeyFromDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function getRecordIntensity(record, maxSets) {
  if (!record) return 0;
  if (!maxSets) return 1;
  const ratio = (record.summary?.totalSets ?? 0) / maxSets;
  return Math.max(1, Math.min(4, Math.ceil(ratio * 4)));
}

function buildCalendarMonths(records = []) {
  if (!records.length) return [];

  const sortedDates = records.map((record) => parseWorkoutDate(record.date)).sort((left, right) => left - right);
  const start = new Date(sortedDates[0].getFullYear(), sortedDates[0].getMonth(), 1);
  const end = new Date(sortedDates.at(-1).getFullYear(), sortedDates.at(-1).getMonth() + 1, 0);
  const monthRanges = [];

  const cursor = new Date(start);
  while (cursor <= end) {
    const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    monthRanges.push({
      key: monthKeyForDate(firstDay),
      title: formatMonthTitle(firstDay),
      firstDay,
      lastDay,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return monthRanges;
}

function monthLabel(year, month) {
  return `${year}年${month}月`;
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

function getWorkoutDialog() {
  return document.querySelector("#workout-form-dialog");
}

function setWorkoutDialogTitle(text) {
  document.querySelector("#workout-dialog-title").textContent = text;
}

function openWorkoutDialog(record = null) {
  const dialog = getWorkoutDialog();
  fillForm(record);
  setWorkoutDialogTitle(record ? "编辑训练记录" : "新增一堂训练");
  document.querySelector("#workout-form-status").textContent = record
    ? "已载入历史训练，保存后会覆盖这条记录。"
    : "填写完成后保存，这堂训练会立即进入日历。";

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "open");
  }
}

function closeWorkoutDialog() {
  const dialog = getWorkoutDialog();
  if (dialog.open && typeof dialog.close === "function") {
    dialog.close();
    return;
  }
  dialog.removeAttribute("open");
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

function workoutPreviewHtml(record) {
  if (!record) {
    return `<div class="calendar-empty-state">点击训练日历里的某一天，查看那天的具体训练记录。</div>`;
  }

  return `
    <div class="body-record-head">
      <div>
        <div class="body-record-date">${record.date}</div>
        ${renderAreaChips(record.summary?.trainedAreas || record.summary?.targetAreas || [])}
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
  `;
}

function getWorkoutPreviewDialog() {
  return document.querySelector("#workout-preview-dialog");
}

function openWorkoutPreview(record) {
  const dialog = getWorkoutPreviewDialog();
  document.querySelector("#workout-preview-title").textContent = record?.date ? `${record.date} 的训练` : "训练预览";
  document.querySelector("#workout-preview-content").innerHTML = workoutPreviewHtml(record);
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "open");
  }
}

function closeWorkoutPreview() {
  const dialog = getWorkoutPreviewDialog();
  if (dialog.open && typeof dialog.close === "function") {
    dialog.close();
    return;
  }
  dialog.removeAttribute("open");
}

function renderCalendar(payload, state) {
  state.payload = payload;
  const records = payload.records || [];
  const target = document.querySelector("#workout-calendar");
  const pickerTrigger = document.querySelector("#workout-calendar-picker-trigger");
  const pickerDialog = document.querySelector("#workout-calendar-picker-dialog");
  const pickerTitle = document.querySelector("#workout-calendar-picker-title");
  const pickerClose = document.querySelector("#workout-calendar-picker-close");
  const yearSelect = document.querySelector("#workout-calendar-year-select");
  const monthSelect = document.querySelector("#workout-calendar-month-select");
  const prevButton = document.querySelector("#workout-calendar-prev-month");
  const nextButton = document.querySelector("#workout-calendar-next-month");
  const meta = document.querySelector("#workout-calendar-meta");
  const recordByDate = new Map(records.map((record) => [record.date, record]));

  if (!records.length) {
    target.innerHTML = `<div class="calendar-empty-state">还没有训练记录，先保存一堂训练，日历就会显示加深的训练日期。</div>`;
    meta.textContent = "";
    pickerTrigger.textContent = "暂无训练";
    pickerTrigger.disabled = true;
    yearSelect.innerHTML = "";
    monthSelect.innerHTML = "";
    prevButton.disabled = true;
    nextButton.disabled = true;
    return;
  }

  const sortedDates = records.map((record) => record.date).sort();
  const firstDay = parseWorkoutDate(sortedDates[0]);
  const lastDay = parseWorkoutDate(sortedDates.at(-1));
  const availableYears = [];
  for (let year = firstDay.getFullYear(); year <= lastDay.getFullYear(); year += 1) {
    availableYears.push(year);
  }
  state.calendarBounds = availableYears;

  state.calendar ||= {
    year: lastDay.getFullYear(),
    month: lastDay.getMonth() + 1,
  };

  const clampCalendar = () => {
    if (state.calendar.year < availableYears[0]) {
      state.calendar.year = availableYears[0];
      state.calendar.month = 1;
      return;
    }
    if (state.calendar.year > availableYears.at(-1)) {
      state.calendar.year = availableYears.at(-1);
      state.calendar.month = 12;
      return;
    }
    if (state.calendar.year === availableYears[0] && state.calendar.month < 1) {
      state.calendar.month = 1;
    }
    if (state.calendar.year === availableYears.at(-1) && state.calendar.month > 12) {
      state.calendar.month = 12;
    }
    state.calendar.month = Math.max(1, Math.min(12, state.calendar.month));
  };

  const currentMonthKey = () => `${state.calendar.year}-${pad2(state.calendar.month)}`;
  const recordsInCurrentMonth = () => records.filter((record) => record.date.startsWith(currentMonthKey()));
  const selectLatestRecordInCurrentMonth = () => {
    const monthRecords = recordsInCurrentMonth();
    if (!monthRecords.length) {
      state.selectedRecordId = "";
      return;
    }
    state.selectedRecordId = monthRecords.slice().sort((left, right) => left.date.localeCompare(right.date)).at(-1).id;
  };

  clampCalendar();

  yearSelect.innerHTML = availableYears.map((year) => `<option value="${year}">${year} 年</option>`).join("");
  monthSelect.innerHTML = Array.from({ length: 12 }, (_, index) => index + 1)
    .map((month) => `<option value="${month}">${month} 月</option>`)
    .join("");

  const selectedRecord = state.selectedRecordId
    ? records.find((record) => record.id === state.selectedRecordId) || null
    : null;
  if (!selectedRecord || !selectedRecord.date.startsWith(currentMonthKey())) {
    selectLatestRecordInCurrentMonth();
  }

  function renderMonth() {
    const maxSets = Math.max(...records.map((record) => record.summary?.totalSets ?? 0), 0);
    const firstVisibleDay = new Date(state.calendar.year, state.calendar.month - 1, 1);
    const lastVisibleDay = new Date(state.calendar.year, state.calendar.month, 0);
    const firstDayOffset = firstVisibleDay.getDay();
    const monthRecords = recordsInCurrentMonth();

    const cells = [];
    for (let i = 0; i < firstDayOffset; i += 1) {
      cells.push('<div class="calendar-day calendar-empty" aria-hidden="true"></div>');
    }

    const current = new Date(firstVisibleDay);
    while (current <= lastVisibleDay) {
      const dateKey = dateKeyFromDate(current);
      const record = recordByDate.get(dateKey);
      if (record) {
        const intensity = getRecordIntensity(record, maxSets);
        const isSelected = record.id === state.selectedRecordId;
        cells.push(`
          <button
            class="calendar-day has-record heat-${intensity}${isSelected ? " is-selected" : ""}"
            type="button"
            data-calendar-id="${record.id}"
            title="${record.date}：${record.summary?.exerciseCount ?? 0} 个动作，${record.summary?.totalSets ?? 0} 组"
          >
            <strong>${current.getDate()}</strong>
            <span>${record.summary?.exerciseCount ?? 0} 动作</span>
            <small>${record.summary?.totalSets ?? 0} 组</small>
          </button>
        `);
      } else {
        cells.push(`
          <div class="calendar-day calendar-empty" aria-label="${dateKey}">
            <strong>${current.getDate()}</strong>
            <span>休息</span>
          </div>
        `);
      }
      current.setDate(current.getDate() + 1);
    }

    target.innerHTML = `
      <section class="calendar-month">
        <div class="calendar-month-head">
          <strong>${monthLabel(state.calendar.year, state.calendar.month)}</strong>
          <span>${monthRecords.length} 次训练</span>
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
        <div class="calendar-grid">${cells.join("")}</div>
      </section>
    `;

    pickerTrigger.textContent = monthLabel(state.calendar.year, state.calendar.month);
    pickerTitle.textContent = `切换到 ${monthLabel(state.calendar.year, state.calendar.month)}`;
    meta.textContent = `${monthLabel(state.calendar.year, state.calendar.month)} · ${monthRecords.length} 次训练`;
    prevButton.disabled = state.calendar.year === availableYears[0] && state.calendar.month === 1;
    nextButton.disabled = state.calendar.year === availableYears.at(-1) && state.calendar.month === 12;
  }

  if (!state.calendarControlsBound) {
    yearSelect.addEventListener("change", () => {
      state.calendar.year = Number(yearSelect.value);
      clampCalendar();
      selectLatestRecordInCurrentMonth();
      renderAll(state.payload, state);
    });

    monthSelect.addEventListener("change", () => {
      state.calendar.month = Number(monthSelect.value);
      clampCalendar();
      selectLatestRecordInCurrentMonth();
      renderAll(state.payload, state);
    });

    prevButton.addEventListener("click", () => {
      if (state.calendar.month === 1) {
        if (state.calendar.year > state.calendarBounds[0]) {
          state.calendar.month = 12;
          state.calendar.year -= 1;
        }
      } else {
        state.calendar.month -= 1;
      }
      clampCalendar();
      selectLatestRecordInCurrentMonth();
      renderAll(state.payload, state);
    });

    nextButton.addEventListener("click", () => {
      if (state.calendar.month === 12) {
        if (state.calendar.year < state.calendarBounds.at(-1)) {
          state.calendar.month = 1;
          state.calendar.year += 1;
        }
      } else {
        state.calendar.month += 1;
      }
      clampCalendar();
      selectLatestRecordInCurrentMonth();
      renderAll(state.payload, state);
    });

    target.addEventListener("click", (event) => {
      const calendarId = event.target.closest("[data-calendar-id]")?.dataset.calendarId;
      if (!calendarId) return;
      state.selectedRecordId = calendarId;
      renderCalendar(state.payload, state);
      const record = (state.payload.records || []).find((item) => item.id === calendarId) || null;
      openWorkoutPreview(record);
    });

    state.calendarControlsBound = true;
  }

  if (!state.workoutCalendarPickerBound) {
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

    state.workoutCalendarPickerBound = true;
  }

  yearSelect.value = String(state.calendar.year);
  monthSelect.value = String(state.calendar.month);

  renderMonth();
}

function ensureSelectedRecord(state) {
  if (state.payload.records.some((item) => item.id === state.selectedRecordId)) return;
  state.selectedRecordId = state.payload.latestRecord?.id || state.payload.records.at(-1)?.id || "";
}

function renderAll(payload, state) {
  ensureSelectedRecord(state);
  renderHero(payload);
  renderSummary(payload);
  renderCalendar(payload, state);
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
  const workoutDialog = getWorkoutDialog();
  const workoutPreviewDialog = getWorkoutPreviewDialog();

  document.querySelector("#open-workout-dialog-button").addEventListener("click", () => {
    openWorkoutDialog();
  });

  document.querySelector("#close-workout-dialog-button").addEventListener("click", () => {
    closeWorkoutDialog();
  });

  workoutDialog.addEventListener("click", (event) => {
    if (event.target === workoutDialog) closeWorkoutDialog();
  });

  document.querySelector("#workout-preview-close").addEventListener("click", () => {
    closeWorkoutPreview();
  });

  workoutPreviewDialog.addEventListener("click", (event) => {
    if (event.target === workoutPreviewDialog) closeWorkoutPreview();
  });

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
    setWorkoutDialogTitle("新增一堂训练");
    document.querySelector("#workout-form-status").textContent = "表单已重置。";
  });

  document.querySelector("#workout-record-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.querySelector("#workout-form-status");
    status.textContent = "正在保存...";
    try {
      const submittedRecordId = form.dataset.recordId || "";
      const submittedDate = form.elements.date.value;
      state.payload = await saveRecord();
      state.selectedRecordId = submittedRecordId || state.payload.records.filter((item) => item.date === submittedDate).at(-1)?.id || state.payload.latestRecord?.id || state.selectedRecordId;
      renderAll(state.payload, state);
      fillForm();
      setWorkoutDialogTitle("新增一堂训练");
      status.textContent = "训练记录已保存。";
      closeWorkoutDialog();
    } catch (error) {
      status.textContent = error.message;
    }
  });

  document.querySelector("#workout-preview-content").addEventListener("click", async (event) => {
    const editId = event.target.closest("[data-edit-id]")?.dataset.editId;
    if (editId) {
      const record = (state.payload.records || []).find((item) => item.id === editId);
      closeWorkoutPreview();
      openWorkoutDialog(record);
      return;
    }

    const deleteId = event.target.closest("[data-delete-id]")?.dataset.deleteId;
    if (deleteId) {
      if (!window.confirm("确认删除这条训练记录吗？")) return;
      try {
        state.payload = await deleteRecord(deleteId);
        closeWorkoutPreview();
        renderAll(state.payload, state);
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
  const latestRecord = payload.latestRecord || payload.records?.at(-1) || null;
  const latestCalendarDate = latestRecord?.date ? parseWorkoutDate(latestRecord.date) : new Date();
  const state = {
    payload,
    selectedRecordId: payload.latestRecord?.id || payload.records?.at(-1)?.id || "",
    calendar: {
      year: latestCalendarDate.getFullYear(),
      month: latestCalendarDate.getMonth() + 1,
    },
  };
  renderAll(payload, state);
  fillForm();
  bindActions(state);
}

main().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<main class="page-shell"><section class="paper-panel"><h1>健身记录页加载失败</h1><p class="hero-text">${error.message}</p></section></main>`;
});
