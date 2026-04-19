const {
  clearStudentToken,
  escapeHtml,
  getStudentToken,
  registerVisitor,
  request,
  requestBlob,
  triggerBrowserDownload,
} = window.PlatformClient;

const studentState = {
  profile: null,
  exams: [],
  materials: [],
  exam: null,
  answers: {},
  currentIndex: 0,
  timerId: 0,
  timeLeft: 0,
  result: null,
  translations: {},
  questionNavCollapsed: true,
};

const studentEl = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheStudentElements();
  bindStudentEvents();
  initStudentPage().catch((error) => {
    console.error(error);
    if (error.status === 403) {
      showBlocked(error.message);
      return;
    }
    logoutAndReturn();
  });
});

function cacheStudentElements() {
  [
    "appShell",
    "blockedScreen",
    "blockedMessage",
    "studentName",
    "studentEmail",
    "statsPublished",
    "statsSolved",
    "statsDownloads",
    "dashboardView",
    "examView",
    "resultView",
    "dashboardBtn",
    "logoutBtn",
    "dashboardExamCount",
    "examList",
    "materialList",
    "historyResults",
    "historyDownloads",
    "currentExamTitle",
    "timerValue",
    "questionIndex",
    "questionCount",
    "questionPoints",
    "progressFill",
    "questionNav",
    "questionNavWrap",
    "toggleQuestionNavBtn",
    "questionCard",
    "prevQuestionBtn",
    "nextQuestionBtn",
    "submitExamBtn",
    "resultExamTitle",
    "resultScore",
    "resultDetails",
    "resultReviewList",
    "backDashboardBtn",
  ].forEach((id) => {
    studentEl[id] = document.getElementById(id);
  });
}

function bindStudentEvents() {
  studentEl.logoutBtn.addEventListener("click", logoutAndReturn);
  studentEl.dashboardBtn.addEventListener("click", goToDashboard);
  studentEl.prevQuestionBtn.addEventListener("click", () => moveQuestion(-1));
  studentEl.nextQuestionBtn.addEventListener("click", () => moveQuestion(1));
  studentEl.submitExamBtn.addEventListener("click", submitExam);
  studentEl.toggleQuestionNavBtn.addEventListener("click", toggleQuestionNav);
  studentEl.backDashboardBtn.addEventListener("click", async () => {
    await refreshProfileData();
    goToDashboard();
  });
}

async function initStudentPage() {
  if (!getStudentToken()) {
    window.location.href = "/";
    return;
  }

  const access = await request("/api/access/status", {
    method: "POST",
    json: {},
  });

  if (!access.authenticated) {
    clearStudentToken();
    window.location.href = "/";
    return;
  }

  await Promise.all([
    refreshProfileData(),
    refreshExams(),
    refreshMaterials(),
  ]);

  studentEl.appShell.classList.remove("hidden");
  renderDashboard();
  await registerVisitor("page_open", {
    studentName: studentState.profile?.name || "",
    studentEmail: studentState.profile?.email || "",
  });
}

async function refreshProfileData() {
  const data = await request("/api/student/me");
  studentState.profile = data.student || null;
}

async function refreshExams() {
  const data = await request("/api/exams");
  studentState.exams = Array.isArray(data.exams) ? data.exams : [];
}

async function refreshMaterials() {
  const data = await request("/api/materials");
  studentState.materials = Array.isArray(data.subjects) ? data.subjects : [];
}

function renderDashboard() {
  stopTimer();
  showStudentView("dashboard");
  renderProfileHeader();
  renderExamCards();
  renderMaterialCards();
  renderHistory();
}

function showStudentView(view) {
  studentEl.dashboardView.classList.toggle("hidden", view !== "dashboard");
  studentEl.examView.classList.toggle("hidden", view !== "exam");
  studentEl.resultView.classList.toggle("hidden", view !== "result");
}

function renderProfileHeader() {
  const profile = studentState.profile || {};
  studentEl.studentName.textContent = profile.name || "-";
  studentEl.studentEmail.textContent = profile.email || "-";
  studentEl.statsPublished.textContent = String(studentState.exams.length);
  studentEl.statsSolved.textContent = String((profile.results || []).length);
  studentEl.statsDownloads.textContent = String((profile.downloads || []).length);
  studentEl.dashboardExamCount.textContent = String(studentState.exams.length);
}

function renderExamCards() {
  if (!studentState.exams.length) {
    studentEl.examList.innerHTML = emptyCard("لا توجد اختبارات منشورة حالياً.");
    return;
  }

  studentEl.examList.innerHTML = studentState.exams
    .map(
      (exam) => `
        <article class="student-exam-card">
          <div class="student-exam-card-head">
            <h3>${escapeHtml(exam.examTitle)}</h3>
            <button class="btn primary compact-btn" data-start-exam="${exam.id}" type="button">ابدأ</button>
          </div>

          <div class="student-exam-metrics">
            <div class="student-metric-box">
              <span>الأسئلة</span>
              <strong>${Number(exam.questionCount || 0)}</strong>
            </div>
            <div class="student-metric-box">
              <span>الدرجة</span>
              <strong>${Number(exam.totalPoints || 0)}</strong>
            </div>
            <div class="student-metric-box">
              <span>الوقت</span>
              <strong>${Number(exam.duration || 0)} د</strong>
            </div>
          </div>
        </article>
      `,
    )
    .join("");

  studentEl.examList.querySelectorAll("[data-start-exam]").forEach((button) => {
    button.addEventListener("click", () => startExam(button.dataset.startExam));
  });
}

function renderMaterialCards() {
  if (!studentState.materials.length) {
    studentEl.materialList.innerHTML = emptyCard("لا توجد ملفات مرفوعة حالياً.");
    return;
  }

  const cards = [];
  studentState.materials.forEach((subject) => {
    (subject.sections || []).forEach((section) => {
      (section.summaries || []).forEach((summary) => {
        if (!summary.hasFile || !summary.downloadUrl) {
          return;
        }

        cards.push(`
          <article class="material-download-card">
            <div>
              <span class="material-subject">${escapeHtml(subject.name)}</span>
              <h4>${escapeHtml(summary.title)}</h4>
              <p class="subtle">${escapeHtml(section.name)}</p>
            </div>
            <button class="btn ghost compact-btn" data-download-summary="${summary.id}" data-file-name="${escapeHtml(summary.fileName || "summary.pdf")}" type="button">تحميل</button>
          </article>
        `);
      });
    });
  });

  studentEl.materialList.innerHTML = cards.length ? cards.join("") : emptyCard("لا توجد ملفات قابلة للتحميل حالياً.");

  studentEl.materialList.querySelectorAll("[data-download-summary]").forEach((button) => {
    button.addEventListener("click", () => downloadSummary(button.dataset.downloadSummary, button.dataset.fileName));
  });
}

function renderHistory() {
  const results = studentState.profile?.results || [];
  const downloads = studentState.profile?.downloads || [];

  studentEl.historyResults.innerHTML = results.length
    ? results
        .map(
          (result) => `
            <article class="history-card">
              <strong>${escapeHtml(result.examTitle || "امتحان")}</strong>
              <span>${escapeHtml(result.submittedAt || "")}</span>
              <span>${Number(result.earnedPoints || 0)} / ${Number(result.totalPoints || 0)}</span>
              <span>${result.scorePercent === null || result.scorePercent === undefined ? "--" : `${Number(result.scorePercent)}%`}</span>
            </article>
          `,
        )
        .join("")
    : emptyCard("لم تحل أي اختبار بعد.");

  studentEl.historyDownloads.innerHTML = downloads.length
    ? downloads
        .map(
          (download) => `
            <article class="history-card">
              <strong>${escapeHtml(download.summaryTitle || download.fileName || "ملف")}</strong>
              <span>${escapeHtml(download.subjectName || "")}</span>
              <span>${escapeHtml(download.downloadedAt || "")}</span>
            </article>
          `,
        )
        .join("")
    : emptyCard("لم تحمل أي ملف بعد.");
}

async function downloadSummary(summaryId, fileName) {
  try {
    const response = await requestBlob(`/api/summaries/${encodeURIComponent(summaryId)}/download`);
    const blob = await response.blob();
    triggerBrowserDownload(blob, fileName || "summary.pdf");
    await refreshProfileData();
    renderProfileHeader();
    renderHistory();
  } catch (error) {
    handleStudentError(error);
  }
}

async function startExam(examId) {
  try {
    const data = await request(`/api/exams/${encodeURIComponent(examId)}`);
    stopTimer();
    studentState.exam = data.exam;
    studentState.answers = {};
    studentState.currentIndex = 0;
    studentState.result = null;
    studentState.translations = {};
    studentState.questionNavCollapsed = true;
    studentState.timeLeft = Number(data.exam.duration || 0) * 60;
    showStudentView("exam");
    renderExamView();
    startTimer();
    await registerVisitor("identity_update", {
      studentName: studentState.profile?.name || "",
      studentEmail: studentState.profile?.email || "",
    });
  } catch (error) {
    handleStudentError(error);
  }
}

function startTimer() {
  stopTimer();
  studentEl.timerValue.textContent = formatTime(studentState.timeLeft);
  studentState.timerId = window.setInterval(() => {
    studentState.timeLeft = Math.max(0, studentState.timeLeft - 1);
    studentEl.timerValue.textContent = formatTime(studentState.timeLeft);
    if (studentState.timeLeft <= 0) {
      stopTimer();
      submitExam();
    }
  }, 1000);
}

function stopTimer() {
  if (studentState.timerId) {
    window.clearInterval(studentState.timerId);
    studentState.timerId = 0;
  }
}

function moveQuestion(direction) {
  if (!studentState.exam) {
    return;
  }

  const nextIndex = studentState.currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= studentState.exam.questions.length) {
    return;
  }

  studentState.currentIndex = nextIndex;
  renderExamView();
}

function renderExamView() {
  const exam = studentState.exam;
  if (!exam) {
    return;
  }

  const question = exam.questions[studentState.currentIndex];
  const translation = studentState.translations[question.id];

  studentEl.currentExamTitle.textContent = exam.examTitle || "الامتحان";
  studentEl.questionIndex.textContent = String(studentState.currentIndex + 1);
  studentEl.questionCount.textContent = String(exam.questions.length);
  studentEl.questionPoints.textContent = String(Number(question.points || 0));
  studentEl.timerValue.textContent = formatTime(studentState.timeLeft);
  studentEl.progressFill.style.width = `${Math.round((answeredCount() / Math.max(exam.questions.length, 1)) * 100)}%`;
  studentEl.questionNavWrap.classList.toggle("hidden", studentState.questionNavCollapsed);
  studentEl.toggleQuestionNavBtn.textContent = studentState.questionNavCollapsed ? "إظهار أرقام الأسئلة" : "إخفاء أرقام الأسئلة";

  studentEl.questionNav.innerHTML = exam.questions
    .map((item, index) => {
      const answered = isAnswered(item, studentState.answers[index]);
      const classes = ["student-nav-dot"];
      if (index === studentState.currentIndex) {
        classes.push("is-active");
      }
      if (answered) {
        classes.push("is-answered");
      }
      return `<button class="${classes.join(" ")}" data-nav-index="${index}" type="button">${index + 1}</button>`;
    })
    .join("");

  studentEl.questionNav.querySelectorAll("[data-nav-index]").forEach((button) => {
    button.addEventListener("click", () => {
      studentState.currentIndex = Number(button.dataset.navIndex);
      renderExamView();
    });
  });

  const answerMarkup = renderQuestionInput(question, studentState.answers[studentState.currentIndex], translation);
  studentEl.questionCard.innerHTML = `
    <div class="question-meta-row">
      <span class="type-chip ${escapeHtml(question.type)}">${escapeHtml(questionTypeLabel(question.type))}</span>
      <button class="btn ghost compact-btn" id="translateQuestionBtn" type="button">
        ${translation ? "إخفاء الترجمة" : "ترجمة السؤال"}
      </button>
    </div>
    <h3 class="student-question-title">${escapeHtml(question.questionText)}</h3>
    ${
      translation
        ? `
          <div class="translation-box">
            <div>${escapeHtml(translation.questionText)}</div>
            ${
              translation.options?.length
                ? `<div class="translation-options">${translation.options.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
                : ""
            }
          </div>
        `
        : ""
    }
    ${answerMarkup}
  `;

  const translateButton = document.getElementById("translateQuestionBtn");
  translateButton.addEventListener("click", () => toggleTranslation(question));

  if (question.type === "short_answer") {
    const input = studentEl.questionCard.querySelector("[data-short-answer]");
    input.addEventListener("input", (event) => {
      studentState.answers[studentState.currentIndex] = event.target.value;
      studentEl.progressFill.style.width = `${Math.round((answeredCount() / Math.max(exam.questions.length, 1)) * 100)}%`;
      syncNavAnsweredState();
    });
    return;
  }

  studentEl.questionCard.querySelectorAll("[data-option-index]").forEach((button) => {
    button.addEventListener("click", () => {
      studentState.answers[studentState.currentIndex] = Number(button.dataset.optionIndex);
      renderExamView();
    });
  });
}

function renderQuestionInput(question, currentAnswer, translation) {
  if (question.type === "short_answer") {
    return `
      <label class="field">
        <span>الإجابة</span>
        <textarea class="student-text-answer" data-short-answer rows="6" placeholder="${escapeHtml(question.placeholder || "اكتب إجابتك هنا")}">${escapeHtml(currentAnswer || "")}</textarea>
      </label>
    `;
  }

  const translationOptions = Array.isArray(translation?.options) ? translation.options : [];
  return `
    <div class="student-choice-list">
      ${(question.options || [])
        .map((option, index) => {
          const selected = Number(currentAnswer) === index;
          return `
            <button class="student-choice ${selected ? "is-selected" : ""}" data-option-index="${index}" type="button">
              <span class="choice-mark">${index + 1}</span>
              <span class="choice-copy">
                <strong>${escapeHtml(option)}</strong>
                ${translationOptions[index] ? `<small>${escapeHtml(translationOptions[index])}</small>` : ""}
              </span>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
}

async function toggleTranslation(question) {
  if (studentState.translations[question.id]) {
    delete studentState.translations[question.id];
    renderExamView();
    return;
  }

  try {
    const texts = [question.questionText, ...(Array.isArray(question.options) ? question.options : [])].filter(Boolean);
    const targetLang = /[\u0600-\u06FF]/u.test(texts.join(" ")) ? "en" : "ar";
    const data = await request("/api/translate", {
      method: "POST",
      json: {
        targetLang,
        texts,
      },
    });
    studentState.translations[question.id] = {
      questionText: data.translations?.[0] || "",
      options: Array.isArray(data.translations) ? data.translations.slice(1) : [],
    };
    renderExamView();
  } catch (error) {
    handleStudentError(error);
  }
}

async function submitExam() {
  if (!studentState.exam) {
    return;
  }

  studentEl.submitExamBtn.disabled = true;

  try {
    const data = await request(`/api/exams/${encodeURIComponent(studentState.exam.id)}/submit`, {
      method: "POST",
      json: {
        answers: studentState.answers,
      },
    });
    stopTimer();
    studentState.result = data.result;
    studentState.exam = null;
    await refreshProfileData();
    renderResultView();
  } catch (error) {
    handleStudentError(error);
  } finally {
    studentEl.submitExamBtn.disabled = false;
  }
}

function renderResultView() {
  showStudentView("result");
  const result = studentState.result;
  if (!result) {
    studentEl.resultReviewList.innerHTML = emptyCard("لا توجد نتيجة حالياً.");
    return;
  }

  studentEl.resultExamTitle.textContent = result.examTitle || "النتيجة";
  studentEl.resultScore.textContent =
    result.scorePercent === null || result.scorePercent === undefined ? "--" : `${Number(result.scorePercent)}%`;
  studentEl.resultDetails.innerHTML = `
    <article class="student-metric-box">
      <span>الدرجة</span>
      <strong>${Number(result.earnedPoints || 0)} / ${Number(result.totalPoints || 0)}</strong>
    </article>
    <article class="student-metric-box">
      <span>الصحيح</span>
      <strong>${Number(result.correct || 0)}</strong>
    </article>
    <article class="student-metric-box">
      <span>القريب</span>
      <strong>${Number(result.close || 0)}</strong>
    </article>
    <article class="student-metric-box">
      <span>الخطأ</span>
      <strong>${Number(result.wrong || 0)}</strong>
    </article>
    <article class="student-metric-box">
      <span>بدون إجابة</span>
      <strong>${Number(result.skipped || 0)}</strong>
    </article>
  `;

  studentEl.resultReviewList.innerHTML = Array.isArray(result.review) && result.review.length
    ? result.review.map((question, index) => renderReviewCard(question, index)).join("")
    : emptyCard("لا توجد مراجعة متاحة.");
}

function renderReviewCard(question, index) {
  const status = reviewStatus(question);
  const answerText = question.type === "short_answer"
    ? question.userAnswerText || "بدون إجابة"
    : (question.userAnswerIndex >= 0 ? question.options?.[question.userAnswerIndex] || "بدون إجابة" : "بدون إجابة");
  const correctText = question.type === "short_answer"
    ? question.correctAnswerText || question.referenceText || "يحتاج مراجعة"
    : question.options?.[question.correctAnswerIndex] || "غير متوفر";

  return `
    <article class="student-review-card ${status.className}">
      <div class="student-review-head">
        <div>
          <span class="small-badge">سؤال ${index + 1}</span>
          <h4>${escapeHtml(question.questionText)}</h4>
        </div>
        <div class="review-score-badge">${Number(question.earnedPoints || 0)} / ${Number(question.points || 0)}</div>
      </div>

      <div class="review-answer-box">
        <span>إجابتك</span>
        <strong>${escapeHtml(answerText)}</strong>
      </div>

      <div class="review-answer-box review-answer-box-alt">
        <span>${escapeHtml(status.label)}</span>
        <strong>${escapeHtml(correctText)}</strong>
      </div>

      ${
        question.feedback
          ? `<p class="review-feedback">${escapeHtml(question.feedback)}</p>`
          : ""
      }
    </article>
  `;
}

function reviewStatus(question) {
  if (question.pendingManualReview) {
    return {
      className: "is-pending",
      label: "مراجعة",
    };
  }

  if (question.evaluation === "close") {
    return {
      className: "is-close",
      label: "الإجابة الأقرب",
    };
  }

  if (question.isCorrect) {
    return {
      className: "is-correct",
      label: "الإجابة الصحيحة",
    };
  }

  return {
    className: "is-wrong",
    label: "الإجابة الصحيحة",
  };
}

function answeredCount() {
  if (!studentState.exam) {
    return 0;
  }

  return studentState.exam.questions.reduce((total, question, index) => (
    total + (isAnswered(question, studentState.answers[index]) ? 1 : 0)
  ), 0);
}

function isAnswered(question, answer) {
  if (question.type === "short_answer") {
    return Boolean(String(answer || "").trim());
  }

  return Number.isInteger(answer);
}

function syncNavAnsweredState() {
  studentEl.questionNav.querySelectorAll("[data-nav-index]").forEach((button) => {
    const index = Number(button.dataset.navIndex);
    button.classList.toggle("is-answered", isAnswered(studentState.exam.questions[index], studentState.answers[index]));
  });
}

function questionTypeLabel(type) {
  if (type === "true_false") {
    return "صح وخطأ";
  }
  if (type === "short_answer") {
    return "كتابي";
  }
  return "اختيار متعدد";
}

function emptyCard(message) {
  return `
    <div class="empty-card">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function formatTime(seconds) {
  const safeValue = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safeValue / 60).toString().padStart(2, "0");
  const remain = Math.floor(safeValue % 60).toString().padStart(2, "0");
  return `${minutes}:${remain}`;
}

function showBlocked(message) {
  studentEl.appShell.classList.add("hidden");
  studentEl.blockedScreen.classList.remove("hidden");
  studentEl.blockedMessage.innerHTML = escapeHtml(message || "أنت محظور يا حلو، امشي شوف قرايتك براك ;)");
}

function toggleQuestionNav() {
  studentState.questionNavCollapsed = !studentState.questionNavCollapsed;
  if (studentState.exam) {
    renderExamView();
  }
}

function handleStudentError(error) {
  if (error.status === 403) {
    showBlocked(error.message);
    return;
  }

  if (error.status === 401) {
    logoutAndReturn();
    return;
  }

  window.alert(error.message || "حدث خطأ غير متوقع.");
}

async function logoutAndReturn() {
  try {
    await request("/api/auth/logout", {
      method: "POST",
      json: {},
    });
  } catch (error) {
    console.error(error);
  } finally {
    stopTimer();
    clearStudentToken();
    window.location.href = "/";
  }
}

function goToDashboard() {
  if (studentState.exam) {
    const shouldLeave = window.confirm("هل تريد الخروج من الامتحان الحالي؟");
    if (!shouldLeave) {
      return;
    }
  }

  studentState.exam = null;
  studentState.result = null;
  studentState.answers = {};
  studentState.currentIndex = 0;
  studentState.translations = {};
  studentState.questionNavCollapsed = true;
  renderDashboard();
}
