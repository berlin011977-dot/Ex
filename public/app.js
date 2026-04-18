const state = {
  view: "home",
  config: null,
  exams: [],
  owner: {
    authenticated: false,
    password: "",
    preview: null,
    results: [],
  },
  student: {
    name: window.localStorage.getItem("exam-student-name") || "",
    exam: null,
    answers: {},
    currentIndex: 0,
    timerId: null,
    timeLeft: 0,
    result: null,
  },
};

const el = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  init().catch((error) => {
    console.error(error);
    toast(error.message || "تعذر تشغيل الواجهة.");
  });
});

function cacheElements() {
  [
    "homeView",
    "ownerView",
    "studentView",
    "ownerModal",
    "ownerPasswordInput",
    "ownerLoginStatus",
    "fileChip",
    "manualTextInput",
    "durationInput",
    "instructionsInput",
    "processStatus",
    "processBtn",
    "previewEmpty",
    "previewContent",
    "previewQuestionCount",
    "previewDuration",
    "previewTitleInput",
    "previewInstructionsInput",
    "previewQuestions",
    "ownerExamList",
    "studentExamList",
    "homeExamList",
    "homeExamCount",
    "homeUploadLimit",
    "aiBadge",
    "formatBadge",
    "addQuestionBtn",
    "studentLobby",
    "studentExam",
    "studentResult",
    "studentExamTitle",
    "studentExamInstructions",
    "studentCurrentName",
    "studentNameInput",
    "studentNameStatus",
    "timerText",
    "examProgressBar",
    "progressMeta",
    "questionNav",
    "questionCard",
    "resultScore",
    "resultTitle",
    "resultSummary",
    "resultCorrect",
    "resultWrong",
    "resultSkipped",
    "reviewList",
    "ownerResultsList",
    "toast",
    "examFileInput",
  ].forEach((id) => {
    el[id] = document.getElementById(id);
  });
}

function bindEvents() {
  document.getElementById("homeBtn").addEventListener("click", () => showView("home"));
  document.getElementById("studentBtn").addEventListener("click", () => showView("student"));
  document.getElementById("ownerBtn").addEventListener("click", openOwnerModal);
  document.getElementById("heroStudentBtn").addEventListener("click", () => showView("student"));
  document.getElementById("heroOwnerBtn").addEventListener("click", openOwnerModal);
  document.getElementById("closeOwnerModalBtn").addEventListener("click", closeOwnerModal);
  document.getElementById("ownerLogoutBtn").addEventListener("click", logoutOwner);
  document.getElementById("clearPreviewBtn").addEventListener("click", clearPreview);
  document.getElementById("publishBtn").addEventListener("click", publishPreview);
  document.getElementById("addQuestionBtn").addEventListener("click", addPreviewQuestion);
  document.getElementById("prevQuestionBtn").addEventListener("click", () => moveQuestion(-1));
  document.getElementById("nextQuestionBtn").addEventListener("click", () => moveQuestion(1));
  document.getElementById("submitExamBtn").addEventListener("click", submitExam);
  document.getElementById("backToLobbyBtn").addEventListener("click", backToLobby);

  document.getElementById("ownerLoginForm").addEventListener("submit", ownerLogin);
  document.getElementById("processForm").addEventListener("submit", processExam);
  el.examFileInput.addEventListener("change", updateFileChip);
  el.studentNameInput.addEventListener("input", onStudentNameInput);
  el.previewTitleInput.addEventListener("input", () => {
    if (state.owner.preview) {
      state.owner.preview.examTitle = el.previewTitleInput.value;
    }
  });
  el.previewInstructionsInput.addEventListener("input", () => {
    if (state.owner.preview) {
      state.owner.preview.instructions = el.previewInstructionsInput.value;
    }
  });

  el.ownerModal.addEventListener("click", (event) => {
    if (event.target === el.ownerModal) {
      closeOwnerModal();
    }
  });
}

async function init() {
  syncStudentNameField();
  state.config = await request("/api/config");
  renderConfig();
  await refreshExams();
  showView("home");
}

function renderConfig() {
  if (!state.config || !el.homeUploadLimit || !el.aiBadge || !el.formatBadge) {
    return;
  }

  el.homeUploadLimit.textContent = `${state.config.maxUploadSizeMb}MB`;
  el.aiBadge.textContent = state.config.hasAiProcessing ? "ذكاء اصطناعي" : "محلل محسن";
  el.formatBadge.textContent = `الصيغ المدعومة: ${state.config.supportedFormats.join(" / ")} • الأنواع: اختيار متعدد / صح وخطأ / كتابي`;
}

function showView(view) {
  if (view === "owner" && !state.owner.authenticated) {
    openOwnerModal();
    return;
  }

  state.view = view;
  el.homeView.classList.toggle("hidden", view !== "home");
  el.ownerView.classList.toggle("hidden", view !== "owner");
  el.studentView.classList.toggle("hidden", view !== "student");

  if (view === "student") {
    renderStudentArea();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openOwnerModal() {
  if (state.owner.authenticated) {
    closeOwnerModal();
    showView("owner");
    return;
  }

  el.ownerModal.classList.remove("hidden");
  el.ownerPasswordInput.focus();
}

function closeOwnerModal() {
  el.ownerModal.classList.add("hidden");
}

async function ownerLogin(event) {
  event.preventDefault();
  const password = el.ownerPasswordInput.value.trim();

  if (!password) {
    el.ownerLoginStatus.textContent = "أدخل كلمة المرور أولاً.";
    return;
  }

  el.ownerLoginStatus.textContent = "جارٍ التحقق من كلمة المرور...";

  try {
    await request("/api/auth/owner", {
      method: "POST",
      json: { password },
    });

    state.owner.authenticated = true;
    state.owner.password = password;
    el.ownerLoginStatus.textContent = "تم فتح لوحة المالك.";
    el.ownerPasswordInput.value = "";
    await refreshOwnerResults();
    closeOwnerModal();
    showView("owner");
    renderOwnerList();
    toast("تم فتح لوحة المالك.");
  } catch (error) {
    el.ownerLoginStatus.textContent = error.message;
  }
}

function logoutOwner() {
  state.owner.authenticated = false;
  state.owner.password = "";
  state.owner.preview = null;
  state.owner.results = [];
  clearPreview();
  renderOwnerResults();
  showView("home");
  toast("تم تسجيل خروج المالك.");
}

function onStudentNameInput(event) {
  state.student.name = event.target.value.trim();
  window.localStorage.setItem("exam-student-name", state.student.name);
  updateStudentNameStatus();
  if (!state.student.exam && !state.student.result) {
    renderStudentArea();
  }
}

function syncStudentNameField() {
  el.studentNameInput.value = state.student.name;
  updateStudentNameStatus();
}

function updateStudentNameStatus() {
  if (state.student.name) {
    el.studentNameStatus.textContent = `تم تسجيل الاسم: ${state.student.name}. يمكنك الآن بدء أي امتحان.`;
  } else {
    el.studentNameStatus.textContent = "اكتب الاسم أولاً ثم اختر الامتحان من القائمة.";
  }
}

function ensureStudentName() {
  if (state.student.name) {
    return true;
  }

  showView("student");
  updateStudentNameStatus();
  el.studentNameInput.focus();
  toast("اكتب اسم الطالب قبل بدء الامتحان.");
  return false;
}

async function refreshExams() {
  const data = await request("/api/exams");
  state.exams = Array.isArray(data.exams) ? data.exams : [];
  if (state.owner.authenticated) {
    await refreshOwnerResults();
  } else {
    renderOwnerResults();
  }
  renderHomeExams();
  renderOwnerList();
  renderStudentArea();
}

function renderHomeExams() {
  el.homeExamCount.textContent = String(state.exams.length);
}

function renderOwnerList() {
  renderExamCards(el.ownerExamList, state.exams, {
    emptyText: "لا توجد امتحانات منشورة حتى الآن.",
    customActions: (exam) => `
      <div class="action-row">
        <button class="btn ghost" data-action="preview-owner" data-id="${exam.id}" type="button">معاينة</button>
        <button class="btn danger" data-action="delete-owner" data-id="${exam.id}" type="button">حذف</button>
      </div>
    `,
  });

  el.ownerExamList.querySelectorAll("[data-action='preview-owner']").forEach((button) => {
    button.addEventListener("click", () => previewPublishedExam(button.dataset.id));
  });

  el.ownerExamList.querySelectorAll("[data-action='delete-owner']").forEach((button) => {
    button.addEventListener("click", () => deleteExam(button.dataset.id));
  });
}

async function refreshOwnerResults() {
  if (!state.owner.authenticated) {
    state.owner.results = [];
    renderOwnerResults();
    return;
  }

  const data = await request("/api/results", {
    headers: ownerHeaders(),
  });
  state.owner.results = Array.isArray(data.results) ? data.results : [];
  renderOwnerResults();
}

function renderOwnerResults() {
  if (!el.ownerResultsList) {
    return;
  }

  if (!state.owner.results.length) {
    el.ownerResultsList.innerHTML = `
      <div class="empty-card">
        <p>لا توجد نتائج طلاب حتى الآن.</p>
      </div>
    `;
    return;
  }

  el.ownerResultsList.innerHTML = state.owner.results
    .map(
      (result) => `
        <article class="exam-card result-card">
          <div class="exam-card-main">
            <h3>${escapeHtml(result.studentName)} - ${escapeHtml(result.examTitle)}</h3>
            <div class="meta-row">
              <span class="meta-chip">${escapeHtml(result.submittedAt || "")}</span>
              <span class="meta-chip">${result.totalQuestions} سؤال</span>
              <span class="meta-chip">${result.scorePercent === null ? "يدوي" : `${result.scorePercent}%`}</span>
            </div>
            <p class="subtle">
              صحيح: ${result.correct} | خطأ: ${result.wrong} | متروك: ${result.skipped} | مراجعة يدوية: ${result.pendingManualReview}
            </p>
            <details class="result-details">
              <summary>عرض التفاصيل</summary>
              <div class="question-preview-list compact-list">
                ${result.review.map((question, index) => renderReviewQuestion(question, index)).join("")}
              </div>
            </details>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderStudentArea() {
  syncStudentNameField();

  if (state.student.exam) {
    el.studentLobby.classList.add("hidden");
    el.studentExam.classList.remove("hidden");
    el.studentResult.classList.add("hidden");
    renderStudentExam();
    return;
  }

  if (state.student.result) {
    el.studentLobby.classList.add("hidden");
    el.studentExam.classList.add("hidden");
    el.studentResult.classList.remove("hidden");
    renderResult();
    return;
  }

  el.studentLobby.classList.remove("hidden");
  el.studentExam.classList.add("hidden");
  el.studentResult.classList.add("hidden");

  renderExamCards(el.studentExamList, state.exams, {
    emptyText: "لا توجد امتحانات متاحة حالياً.",
    actionLabel: state.student.name ? "بدء الامتحان" : "اكتب اسمك أولاً",
    actionDisabled: !state.student.name,
    onAction: (exam) => startExam(exam.id),
  });
}

function renderExamCards(container, exams, options) {
  if (!exams.length) {
    container.innerHTML = `
      <div class="empty-card">
        <p>${options.emptyText}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = exams
    .map(
      (exam) => `
        <article class="exam-card">
          <div class="exam-card-main">
            <h3>${escapeHtml(exam.examTitle)}</h3>
            <div class="meta-row">
              <span class="meta-chip">${exam.questionCount} سؤال</span>
              <span class="meta-chip">${exam.duration} دقيقة</span>
              <span class="meta-chip">${escapeHtml(exam.publishedAt)}</span>
            </div>
            ${renderQuestionTypeSummary(exam.questionTypes)}
            ${
              exam.instructions
                ? `<p class="subtle">${escapeHtml(exam.instructions)}</p>`
                : ""
            }
          </div>

          <div class="action-row">
            ${options.customActions ? options.customActions(exam) : ""}
            ${
              options.actionLabel
                ? `<button class="btn primary" data-action="generic-start" data-id="${exam.id}" type="button" ${options.actionDisabled ? "disabled" : ""}>${options.actionLabel}</button>`
                : ""
            }
          </div>
        </article>
      `,
    )
    .join("");

  container.querySelectorAll("[data-action='generic-start']").forEach((button) => {
    button.addEventListener("click", () => {
      const exam = exams.find((item) => item.id === button.dataset.id);
      if (exam) {
        options.onAction?.(exam);
      }
    });
  });
}

function updateFileChip() {
  const file = el.examFileInput.files?.[0];
  if (!file) {
    el.fileChip.textContent = "لم يتم اختيار أي ملف بعد.";
    return;
  }

  const sizeMb = (file.size / 1024 / 1024).toFixed(2);
  el.fileChip.textContent = `${file.name} • ${sizeMb}MB`;
}

async function processExam(event) {
  event.preventDefault();

  if (!state.owner.authenticated) {
    openOwnerModal();
    return;
  }

  const manualText = el.manualTextInput.value.trim();
  const file = el.examFileInput.files?.[0];

  if (!file && !manualText) {
    toast("ارفع ملفاً أو الصق النص قبل التحليل.");
    return;
  }

  const formData = new FormData();
  if (file) {
    formData.append("examFile", file);
  }
  formData.append("manualText", manualText);
  formData.append("duration", el.durationInput.value.trim() || "60");
  formData.append("extraInstructions", el.instructionsInput.value.trim());

  el.processBtn.disabled = true;
  el.processStatus.textContent = "جارٍ تحليل الملف...";

  try {
    const data = await request("/api/process-exam", {
      method: "POST",
      body: formData,
      headers: ownerHeaders(),
    });

    state.owner.preview = data.parsed;
    renderPreview();
    el.processStatus.textContent = data.message;
    toast(data.message);
  } catch (error) {
    el.processStatus.textContent = error.message;
    toast(error.message);
  } finally {
    el.processBtn.disabled = false;
  }
}

function renderPreview() {
  if (!state.owner.preview) {
    el.previewEmpty.classList.remove("hidden");
    el.previewContent.classList.add("hidden");
    document.getElementById("publishBtn").textContent = "نشر الامتحان";
    return;
  }

  const preview = state.owner.preview;
  el.previewEmpty.classList.add("hidden");
  el.previewContent.classList.remove("hidden");
  el.previewQuestionCount.textContent = String(preview.questions.length);
  el.previewDuration.textContent = `${preview.duration} د`;
  el.previewTitleInput.value = preview.examTitle;
  el.previewInstructionsInput.value = preview.instructions || "";

  el.previewQuestions.innerHTML = preview.questions
    .map((question, index) => renderPreviewQuestion(question, index))
    .join("");
  document.getElementById("publishBtn").textContent = preview.id ? "حفظ التعديلات" : "نشر الامتحان";
  bindPreviewQuestionEditors();
}

function clearPreview() {
  state.owner.preview = null;
  el.previewTitleInput.value = "";
  el.previewInstructionsInput.value = "";
  renderPreview();
}

async function publishPreview() {
  if (!state.owner.preview) {
    toast("لا توجد معاينة جاهزة للنشر.");
    return;
  }

  const payload = {
    examTitle: el.previewTitleInput.value.trim() || state.owner.preview.examTitle,
    duration: state.owner.preview.duration,
    instructions: el.previewInstructionsInput.value.trim(),
    questions: state.owner.preview.questions,
  };

  try {
    const isUpdate = Boolean(state.owner.preview.id);
    const targetUrl = isUpdate ? `/api/exams/${state.owner.preview.id}` : "/api/exams";

    await request(targetUrl, {
      method: isUpdate ? "PUT" : "POST",
      json: payload,
      headers: ownerHeaders(),
    });
    clearPreview();
    el.manualTextInput.value = "";
    el.instructionsInput.value = "";
    el.durationInput.value = "60";
    el.examFileInput.value = "";
    updateFileChip();
    await refreshExams();
    toast("تم نشر الامتحان.");
  } catch (error) {
    toast(error.message);
  }
}

async function previewPublishedExam(examId) {
  if (!state.owner.authenticated) {
    openOwnerModal();
    return;
  }

  try {
    const data = await request(`/api/exams/${examId}?mode=owner`, {
      headers: ownerHeaders(),
    });
    state.owner.preview = data.exam;
    renderPreview();
    el.previewTitleInput.value = data.exam.examTitle;
    el.previewInstructionsInput.value = data.exam.instructions || "";
    showView("owner");
    toast("تم تحميل معاينة الامتحان.");
  } catch (error) {
    toast(error.message);
  }
}

function addPreviewQuestion() {
  if (!state.owner.preview) {
    state.owner.preview = {
      examTitle: "امتحان جديد",
      duration: Number.parseInt(el.durationInput.value, 10) || 60,
      instructions: "",
      questions: [],
    };
  }

  state.owner.preview.questions.push(createEditableQuestion());
  renderPreview();
}

async function deleteExam(examId) {
  if (!state.owner.authenticated) {
    openOwnerModal();
    return;
  }

  if (!window.confirm("هل تريد حذف هذا الامتحان؟")) {
    return;
  }

  try {
    await request(`/api/exams/${examId}`, {
      method: "DELETE",
      headers: ownerHeaders(),
    });
    if (state.owner.preview?.id === examId) {
      clearPreview();
    }
    await refreshExams();
    toast("تم حذف الامتحان.");
  } catch (error) {
    toast(error.message);
  }
}

async function startExam(examId) {
  if (!ensureStudentName()) {
    return;
  }

  try {
    const data = await request(`/api/exams/${examId}`);
    resetStudentSession();
    state.student.exam = data.exam;
    state.student.timeLeft = data.exam.duration * 60;
    state.student.currentIndex = 0;
    startTimer();
    showView("student");
    renderStudentArea();
  } catch (error) {
    toast(error.message);
  }
}

function renderStudentExam() {
  if (!state.student.exam) {
    return;
  }

  const exam = state.student.exam;
  const question = exam.questions[state.student.currentIndex];

  el.studentCurrentName.textContent = state.student.name || "-";
  el.studentExamTitle.textContent = exam.examTitle;
  el.studentExamInstructions.textContent =
    exam.instructions || "أجب عن كل الأسئلة ثم أرسل الامتحان عند الانتهاء.";
  renderExamProgress();
  renderTimer();

  el.questionNav.innerHTML = exam.questions
    .map((navQuestion, index) => {
      const classes = [
        "question-dot",
        index === state.student.currentIndex ? "active" : "",
        isQuestionAnswered(navQuestion, state.student.answers[index]) ? "answered" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return `<button class="${classes}" data-nav-index="${index}" type="button">${index + 1}</button>`;
    })
    .join("");

  el.questionNav.querySelectorAll("[data-nav-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.student.currentIndex = Number.parseInt(button.dataset.navIndex, 10);
      renderStudentExam();
    });
  });

  el.questionCard.innerHTML = `
    <article class="question-card">
      <div class="question-heading">
        <div class="subtle">سؤال ${state.student.currentIndex + 1} من ${exam.questions.length}</div>
        <span class="type-chip ${question.type}">${escapeHtml(getQuestionTypeLabel(question.type))}</span>
      </div>
      <h4>${escapeHtml(question.questionText)}</h4>
      ${renderStudentAnswerInput(question, state.student.answers[state.student.currentIndex])}
    </article>
  `;

  if (question.type === "short_answer") {
    const input = el.questionCard.querySelector("[data-answer-input]");
    if (input) {
      input.addEventListener("input", (event) => {
        state.student.answers[state.student.currentIndex] = event.target.value;
        renderExamProgress();
        updateQuestionNavState();
      });
    }
    return;
  }

  el.questionCard.querySelectorAll("[data-option-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const optionIndex = Number.parseInt(button.dataset.optionIndex, 10);
      state.student.answers[state.student.currentIndex] = optionIndex;
      renderStudentExam();
    });
  });
}

function renderExamProgress() {
  if (!state.student.exam) {
    return;
  }

  const answeredCount = countAnsweredQuestions(state.student.exam, state.student.answers);
  el.progressMeta.textContent = `${answeredCount} / ${state.student.exam.questions.length} مجاب`;
  el.examProgressBar.style.width = `${(answeredCount / state.student.exam.questions.length) * 100}%`;
}

function updateQuestionNavState() {
  if (!state.student.exam) {
    return;
  }

  const buttons = el.questionNav.querySelectorAll("[data-nav-index]");
  buttons.forEach((button) => {
    const index = Number.parseInt(button.dataset.navIndex, 10);
    const question = state.student.exam.questions[index];
    button.classList.toggle("active", index === state.student.currentIndex);
    button.classList.toggle("answered", isQuestionAnswered(question, state.student.answers[index]));
  });
}

function renderStudentAnswerInput(question, currentAnswer) {
  if (question.type === "short_answer") {
    return `
      <label class="answer-stack">
        <span class="subtle">اكتب إجابتك</span>
        <textarea
          class="short-answer-input"
          data-answer-input="text"
          rows="5"
          placeholder="${escapeHtml(question.placeholder || "اكتب إجابتك هنا")}"
        >${escapeHtml(currentAnswer || "")}</textarea>
      </label>
    `;
  }

  const optionKeys = question.type === "true_false" ? ["1", "2"] : ["A", "B", "C", "D", "E", "F"];
  const selectedAnswer = normalizeAnswerIndex(currentAnswer);

  return `
    <div class="option-list">
      ${question.options
        .map((option, optionIndex) => {
          const selected = selectedAnswer === optionIndex;
          return `
            <button
              class="option-button ${selected ? "selected" : ""}"
              data-option-index="${optionIndex}"
              type="button"
            >
              <span class="option-key">${optionKeys[optionIndex] || optionIndex + 1}</span>
              <span>${escapeHtml(option)}</span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderResult() {
  if (!state.student.result) {
    return;
  }

  const result = state.student.result;
  el.resultTitle.textContent = result.examTitle;
  el.resultScore.textContent = result.scorePercent === null ? "يدوي" : `${result.scorePercent}%`;
  el.resultSummary.textContent = buildResultSummary(result);
  el.resultCorrect.textContent = String(result.correct);
  el.resultWrong.textContent = String(result.wrong);
  el.resultSkipped.textContent = String(result.skipped);

  el.reviewList.innerHTML = result.review
    .map((question, index) => renderReviewQuestion(question, index))
    .join("");
}

function buildResultSummary(result) {
  if (result.scorePercent === null) {
    return `${result.studentName}، تم استلام إجاباتك. هذا الامتحان يحتوي على أسئلة كتابية تحتاج مراجعة يدوية.`;
  }

  if (result.pendingManualReview) {
    return `${result.studentName}، نتيجتك الحالية ${result.scorePercent}% في الأسئلة المصححة تلقائياً، وتبقت ${result.pendingManualReview} أسئلة كتابية للمراجعة.`;
  }

  return `${result.studentName}، أجبت بشكل صحيح عن ${result.correct} من أصل ${result.gradableTotal} سؤال مصحح تلقائياً.`;
}

function createEditableQuestion(type = "multiple_choice") {
  if (type === "short_answer") {
    return {
      type,
      questionText: "",
      options: [],
      correctAnswerIndex: null,
      correctAnswerText: "",
      placeholder: "اكتب إجابتك هنا",
      explanation: "",
    };
  }

  const options = type === "true_false" ? ["صح", "خطأ"] : ["الخيار الأول", "الخيار الثاني"];
  return {
    type,
    questionText: "",
    options,
    correctAnswerIndex: 0,
    correctAnswerText: options[0],
    placeholder: "",
    explanation: "",
  };
}

function convertPreviewQuestionType(question, nextType) {
  const converted = createEditableQuestion(nextType);
  converted.questionText = question.questionText || "";
  converted.explanation = question.explanation || "";

  if (nextType === "short_answer") {
    converted.correctAnswerText = question.correctAnswerText || "";
    converted.placeholder = question.placeholder || "اكتب إجابتك هنا";
    return converted;
  }

  if (Array.isArray(question.options) && question.options.length >= 2 && nextType === "multiple_choice") {
    converted.options = question.options.slice(0, 6);
    converted.correctAnswerIndex = normalizeAnswerIndex(question.correctAnswerIndex) ?? 0;
    converted.correctAnswerText = converted.options[converted.correctAnswerIndex] || converted.options[0] || "";
  }

  if (nextType === "true_false") {
    converted.correctAnswerIndex = normalizeAnswerIndex(question.correctAnswerIndex) ?? 0;
    converted.correctAnswerText = converted.options[converted.correctAnswerIndex] || converted.options[0];
  }

  return converted;
}

function bindPreviewQuestionEditors() {
  el.previewQuestions.querySelectorAll("[data-preview-field]").forEach((input) => {
    const eventName = input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventName, onPreviewFieldChange);
  });

  el.previewQuestions.querySelectorAll("[data-preview-action]").forEach((button) => {
    button.addEventListener("click", onPreviewActionClick);
  });
}

function onPreviewFieldChange(event) {
  const questionIndex = Number.parseInt(event.target.dataset.questionIndex, 10);
  const question = state.owner.preview?.questions?.[questionIndex];
  if (!question) {
    return;
  }

  const field = event.target.dataset.previewField;
  if (field === "type") {
    state.owner.preview.questions[questionIndex] = convertPreviewQuestionType(question, event.target.value);
    renderPreview();
    return;
  }

  if (field === "optionText") {
    const optionIndex = Number.parseInt(event.target.dataset.optionIndex, 10);
    question.options[optionIndex] = event.target.value;
    if (question.type !== "short_answer") {
      question.correctAnswerText = question.options[question.correctAnswerIndex || 0] || "";
    }
    return;
  }

  if (field === "correctAnswerIndex") {
    question.correctAnswerIndex = Number.parseInt(event.target.value, 10) || 0;
    if (question.type !== "short_answer") {
      question.correctAnswerText = question.options[question.correctAnswerIndex] || "";
    }
    renderPreview();
    return;
  }

  question[field] = event.target.value;
}

function onPreviewActionClick(event) {
  const action = event.currentTarget.dataset.previewAction;
  const questionIndex = Number.parseInt(event.currentTarget.dataset.questionIndex, 10);
  const question = state.owner.preview?.questions?.[questionIndex];
  if (!question) {
    return;
  }

  if (action === "remove-question") {
    state.owner.preview.questions.splice(questionIndex, 1);
    renderPreview();
    return;
  }

  if (action === "add-option" && question.type === "multiple_choice" && question.options.length < 6) {
    question.options.push(`الخيار ${question.options.length + 1}`);
    renderPreview();
    return;
  }

  if (action === "remove-option" && question.type === "multiple_choice" && question.options.length > 2) {
    const optionIndex = Number.parseInt(event.currentTarget.dataset.optionIndex, 10);
    question.options.splice(optionIndex, 1);
    question.correctAnswerIndex = Math.min(question.correctAnswerIndex || 0, question.options.length - 1);
    question.correctAnswerText = question.options[question.correctAnswerIndex] || "";
    renderPreview();
  }
}

function renderPreviewQuestion(question, index) {
  const typeLabel = getQuestionTypeLabel(question.type);
  const isShortAnswer = question.type === "short_answer";
  const canAddOption = question.type === "multiple_choice" && question.options.length < 6;

  return `
    <article class="preview-question editable-question">
      <div class="question-heading">
        <div class="subtle">سؤال ${index + 1}</div>
        <div class="action-row compact-actions">
          <span class="type-chip ${question.type}">${escapeHtml(typeLabel)}</span>
          <button class="btn danger compact-btn" data-preview-action="remove-question" data-question-index="${index}" type="button">حذف السؤال</button>
        </div>
      </div>

      <label class="field">
        <span>نوع السؤال</span>
        <select class="preview-select" data-preview-field="type" data-question-index="${index}">
          <option value="multiple_choice" ${question.type === "multiple_choice" ? "selected" : ""}>اختيار متعدد</option>
          <option value="true_false" ${question.type === "true_false" ? "selected" : ""}>صح وخطأ</option>
          <option value="short_answer" ${question.type === "short_answer" ? "selected" : ""}>كتابي</option>
        </select>
      </label>

      <label class="field">
        <span>نص السؤال</span>
        <textarea rows="3" data-preview-field="questionText" data-question-index="${index}">${escapeHtml(question.questionText || "")}</textarea>
      </label>

      ${
        isShortAnswer
          ? `
            <label class="field">
              <span>الإجابة المتوقعة</span>
              <input type="text" data-preview-field="correctAnswerText" data-question-index="${index}" value="${escapeHtml(question.correctAnswerText || "")}">
            </label>
            <label class="field">
              <span>النص الإرشادي داخل الحقل</span>
              <input type="text" data-preview-field="placeholder" data-question-index="${index}" value="${escapeHtml(question.placeholder || "اكتب إجابتك هنا")}">
            </label>
          `
          : `
            <div class="option-editor-list">
              ${question.options
                .map(
                  (option, optionIndex) => `
                    <div class="option-editor-row">
                      <label class="field option-field">
                        <span>الخيار ${optionIndex + 1}</span>
                        <input type="text" data-preview-field="optionText" data-question-index="${index}" data-option-index="${optionIndex}" value="${escapeHtml(option)}">
                      </label>
                      ${
                        question.type === "multiple_choice" && question.options.length > 2
                          ? `<button class="btn ghost compact-btn" data-preview-action="remove-option" data-question-index="${index}" data-option-index="${optionIndex}" type="button">حذف الخيار</button>`
                          : ""
                      }
                    </div>
                  `,
                )
                .join("")}
            </div>
            ${
              canAddOption
                ? `<button class="btn ghost compact-btn" data-preview-action="add-option" data-question-index="${index}" type="button">إضافة خيار</button>`
                : ""
            }
            <label class="field">
              <span>الإجابة الصحيحة</span>
              <select class="preview-select" data-preview-field="correctAnswerIndex" data-question-index="${index}">
                ${question.options
                  .map(
                    (option, optionIndex) => `
                      <option value="${optionIndex}" ${optionIndex === (question.correctAnswerIndex || 0) ? "selected" : ""}>
                        ${escapeHtml(option || `الخيار ${optionIndex + 1}`)}
                      </option>
                    `,
                  )
                  .join("")}
              </select>
            </label>
          `
      }

      <label class="field">
        <span>الشرح أو الملاحظة</span>
        <textarea rows="2" data-preview-field="explanation" data-question-index="${index}">${escapeHtml(question.explanation || "")}</textarea>
      </label>
    </article>
  `;
}

function renderReviewQuestion(question, index) {
  const isPending = question.pendingManualReview;
  const cardStateClass = isPending ? "pending" : question.isCorrect ? "correct" : "wrong";
  const classes = ["preview-question", "review-card", cardStateClass].filter(Boolean).join(" ");
  const userAnswerText = getUserAnswerLabel(question);
  const correctAnswerText = getCorrectAnswerLabel(question);
  const hasObjectiveOptions = Array.isArray(question.options) && question.options.length >= 2;

  return `
    <article class="${classes}">
      <div class="question-heading">
        <div class="subtle">سؤال ${index + 1}</div>
        <span class="type-chip ${question.type}">${escapeHtml(getQuestionTypeLabel(question.type))}</span>
      </div>
      <h4>${escapeHtml(question.questionText)}</h4>
      <div class="answer-chip ${getReviewChipClass(question)}">${escapeHtml(userAnswerText)}</div>
      ${
        hasObjectiveOptions
          ? `
            <ul>
              ${question.options
                .map((option, optionIndex) => {
                  const itemClasses = [];
                  if (optionIndex === question.correctAnswerIndex) {
                    itemClasses.push("correct");
                  }
                  if (question.userAnswerIndex === optionIndex && optionIndex !== question.correctAnswerIndex) {
                    itemClasses.push("wrong");
                  }

                  return `<li class="${itemClasses.join(" ")}">${escapeHtml(option)}</li>`;
                })
                .join("")}
            </ul>
          `
          : `
            <div class="answer-box">
              ${correctAnswerText ? `الإجابة المتوقعة: ${escapeHtml(correctAnswerText)}` : "هذا السؤال يحتاج مراجعة يدوية من المالك."}
            </div>
          `
      }
      <div class="${isPending ? "pending-label" : "review-label"}">
        ${isPending ? "بانتظار مراجعة السؤال الكتابي." : `الإجابة الصحيحة: ${escapeHtml(correctAnswerText)}`}
      </div>
      ${
        question.explanation
          ? `<p>${escapeHtml(question.explanation)}</p>`
          : ""
      }
    </article>
  `;
}

function getReviewChipClass(question) {
  if (question.pendingManualReview) {
    return "pending";
  }

  if (question.isCorrect === true) {
    return "correct";
  }

  if (question.isCorrect === false) {
    return "wrong";
  }

  return "";
}

function getUserAnswerLabel(question) {
  if (question.type === "short_answer") {
    return question.userAnswerText ? `إجابتك: ${question.userAnswerText}` : "لم تتم الإجابة";
  }

  if (question.userAnswerIndex !== null && question.userAnswerIndex >= 0) {
    return `إجابتك: ${question.options[question.userAnswerIndex] || "غير معروفة"}`;
  }

  return "لم تتم الإجابة";
}

function getCorrectAnswerLabel(question) {
  if (question.type === "short_answer") {
    return question.correctAnswerText || "";
  }

  return question.options?.[question.correctAnswerIndex] || question.correctAnswerText || "";
}

function getQuestionTypeLabel(type) {
  switch (type) {
    case "true_false":
      return "صح وخطأ";
    case "short_answer":
      return "كتابي";
    default:
      return "اختيار متعدد";
  }
}

function renderQuestionTypeSummary(questionTypes) {
  if (!questionTypes || typeof questionTypes !== "object") {
    return "";
  }

  const entries = Object.entries(questionTypes).filter(([, count]) => Number(count) > 0);
  if (!entries.length) {
    return "";
  }

  return `
    <div class="type-badges">
      ${entries
        .map(
          ([type, count]) =>
            `<span class="type-chip ${escapeHtml(type)}">${escapeHtml(getQuestionTypeLabel(type))}: ${count}</span>`,
        )
        .join("")}
    </div>
  `;
}

function countAnsweredQuestions(exam, answers) {
  return exam.questions.reduce((total, question, index) => {
    return total + (isQuestionAnswered(question, answers[index]) ? 1 : 0);
  }, 0);
}

function isQuestionAnswered(question, answerValue) {
  if (!question) {
    return false;
  }

  if (question.type === "short_answer") {
    return Boolean(String(answerValue || "").trim());
  }

  return Number.isInteger(normalizeAnswerIndex(answerValue));
}

function normalizeAnswerIndex(value) {
  const parsed = Number.isInteger(value) ? value : Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function moveQuestion(offset) {
  if (!state.student.exam) {
    return;
  }

  const nextIndex = state.student.currentIndex + offset;
  if (nextIndex < 0) {
    return;
  }

  if (nextIndex >= state.student.exam.questions.length) {
    submitExam();
    return;
  }

  state.student.currentIndex = nextIndex;
  renderStudentExam();
}

function startTimer() {
  stopTimer();
  renderTimer();

  state.student.timerId = window.setInterval(() => {
    state.student.timeLeft -= 1;
    renderTimer();
    if (state.student.timeLeft <= 0) {
      submitExam();
    }
  }, 1000);
}

function stopTimer() {
  if (state.student.timerId) {
    window.clearInterval(state.student.timerId);
    state.student.timerId = null;
  }
}

function renderTimer() {
  const remaining = Math.max(0, state.student.timeLeft);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  el.timerText.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

async function submitExam() {
  if (!state.student.exam) {
    return;
  }

  stopTimer();

  try {
    const data = await request(`/api/exams/${state.student.exam.id}/submit`, {
      method: "POST",
      json: {
        studentName: state.student.name,
        answers: state.student.answers,
      },
    });
    state.student.result = data.result;
    state.student.exam = null;
    renderStudentArea();
    toast("تم إرسال الامتحان.");
  } catch (error) {
    toast(error.message);
  }
}

function backToLobby() {
  resetStudentSession();
  renderStudentArea();
  toast("تمت العودة إلى قائمة الامتحانات.");
}

function resetStudentSession() {
  stopTimer();
  state.student.exam = null;
  state.student.answers = {};
  state.student.currentIndex = 0;
  state.student.timeLeft = 0;
  state.student.result = null;
}

function ownerHeaders() {
  return state.owner.password ? { "x-owner-password": state.owner.password } : {};
}

async function request(url, options = {}) {
  const fetchOptions = {
    method: options.method || "GET",
    headers: {
      ...options.headers,
    },
  };

  if (options.json) {
    fetchOptions.headers["Content-Type"] = "application/json";
    fetchOptions.body = JSON.stringify(options.json);
  } else if (options.body) {
    fetchOptions.body = options.body;
  }

  const response = await fetch(url, fetchOptions);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { error: await response.text() };

  if (!response.ok) {
    throw new Error(payload.error || "حدث خطأ في الطلب.");
  }

  return payload;
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  window.clearTimeout(toast._timer);
  toast._timer = window.setTimeout(() => {
    el.toast.classList.remove("show");
  }, 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
