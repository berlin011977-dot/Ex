const state = {
  view: "home",
  config: null,
  exams: [],
  owner: {
    authenticated: false,
    password: "",
    preview: null,
    results: [],
    subjects: [],
    bans: [],
    editingSummaryId: "",
  },
  student: {
    name: window.localStorage.getItem("exam-student-name") || "",
    email: window.localStorage.getItem("exam-student-email") || "",
    exam: null,
    answers: {},
    currentIndex: 0,
    timerId: null,
    timeLeft: 0,
    result: null,
    materials: [],
    translations: {},
    translationVisible: {},
    translationLoadingKey: "",
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
    "materialFileChip",
    "manualTextInput",
    "materialTextInput",
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
    "previewMaterialSources",
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
    "studentCurrentEmail",
    "studentNameInput",
    "studentEmailInput",
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
    "resultClose",
    "resultWrong",
    "resultSkipped",
    "resultPoints",
    "reviewList",
    "ownerResultsList",
    "toast",
    "examFileInput",
    "materialFileInput",
    "materialLibraryForm",
    "subjectNameInput",
    "subjectDescriptionInput",
    "sectionNameInput",
    "summaryTitleInput",
    "summaryTextInput",
    "summaryFileInput",
    "summaryFileChip",
    "summaryStatus",
    "clearSummaryEditorBtn",
    "ownerMaterialsList",
    "banForm",
    "banTypeInput",
    "banValueInput",
    "banReasonInput",
    "banStatus",
    "ownerBanList",
    "studentMaterialList",
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
  el.materialLibraryForm.addEventListener("submit", saveSummary);
  el.banForm.addEventListener("submit", addBan);
  el.examFileInput.addEventListener("change", updateFileChip);
  el.materialFileInput.addEventListener("change", updateMaterialFileChip);
  el.summaryFileInput.addEventListener("change", updateSummaryFileChip);
  el.studentNameInput.addEventListener("input", onStudentNameInput);
  el.studentEmailInput.addEventListener("input", onStudentEmailInput);
  el.clearSummaryEditorBtn.addEventListener("click", resetSummaryEditor);
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
  if (window.location.pathname.endsWith("/admin.html")) {
    document.title = "لوحة المالك | منصة الامتحانات";
  }
  const summaryUploadDrop = el.summaryFileInput?.closest(".upload-drop");
  if (summaryUploadDrop) {
    const title = summaryUploadDrop.querySelector(".upload-title");
    const subtitle = summaryUploadDrop.querySelector(".upload-sub");
    if (title) {
      title.textContent = "ارفع ملف الملخص";
    }
    if (subtitle) {
      subtitle.textContent = "اختياري: TXT أو PDF أو DOCX وسيظهر كملف قابل للتحميل مع محاولة استخراج النص داخل المنصة";
    }
  }
  updateSummaryFileChip();
  syncStudentIdentityFields();
  state.config = await request("/api/config");
  renderConfig();
  await Promise.all([refreshExams(), refreshMaterials()]);
  if (window.location.pathname.endsWith("/admin.html")) {
    openOwnerModal();
    return;
  }
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
    await Promise.all([refreshOwnerResults(), refreshOwnerPlatform()]);
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
  state.owner.subjects = [];
  state.owner.bans = [];
  state.owner.editingSummaryId = "";
  clearPreview();
  resetSummaryEditor();
  renderOwnerResults();
  renderMaterialsLibrary();
  renderOwnerBans();
  showView("home");
  toast("تم تسجيل خروج المالك.");
}

function onStudentNameInput(event) {
  state.student.name = event.target.value.trim();
  window.localStorage.setItem("exam-student-name", state.student.name);
  updateStudentIdentityStatus();
  if (!state.student.exam && !state.student.result) {
    renderStudentArea();
  }
}

function onStudentEmailInput(event) {
  state.student.email = event.target.value.trim().toLowerCase();
  window.localStorage.setItem("exam-student-email", state.student.email);
  updateStudentIdentityStatus();
  if (!state.student.exam && !state.student.result) {
    renderStudentArea();
  }
}

function syncStudentIdentityFields() {
  el.studentNameInput.value = state.student.name;
  el.studentEmailInput.value = state.student.email;
  updateStudentIdentityStatus();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(String(value || "").trim().toLowerCase());
}

function hasValidStudentIdentity() {
  return Boolean(state.student.name) && isValidEmail(state.student.email);
}

function updateStudentIdentityStatus() {
  if (state.student.name && isValidEmail(state.student.email)) {
    el.studentNameStatus.textContent = `تم تسجيل الطالب ${state.student.name} بالبريد ${state.student.email}. يمكنك الآن بدء أي امتحان.`;
  } else if (state.student.name && !state.student.email) {
    el.studentNameStatus.textContent = "اكتب البريد الإلكتروني الصحيح قبل بدء الامتحان.";
  } else if (state.student.name && !isValidEmail(state.student.email)) {
    el.studentNameStatus.textContent = "صيغة البريد الإلكتروني غير صحيحة.";
  } else {
    el.studentNameStatus.textContent = "اكتب الاسم والبريد الإلكتروني الصحيح أولاً ثم اختر الامتحان من القائمة.";
  }
}

function ensureStudentIdentity() {
  if (hasValidStudentIdentity()) {
    return true;
  }

  showView("student");
  updateStudentIdentityStatus();
  if (!state.student.name) {
    el.studentNameInput.focus();
  } else {
    el.studentEmailInput.focus();
  }
  toast("اكتب الاسم والبريد الإلكتروني الصحيح قبل بدء الامتحان.");
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

async function refreshMaterials() {
  const data = await request("/api/materials");
  state.student.materials = Array.isArray(data.subjects) ? data.subjects : [];
  renderStudentMaterials();
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

async function refreshOwnerPlatform() {
  if (!state.owner.authenticated) {
    state.owner.subjects = [];
    state.owner.bans = [];
    renderMaterialsLibrary();
    renderOwnerBans();
    return;
  }

  const data = await request("/api/admin/platform", {
    headers: ownerHeaders(),
  });
  state.owner.subjects = Array.isArray(data.subjects) ? data.subjects : [];
  state.owner.bans = Array.isArray(data.bans) ? data.bans : [];
  renderMaterialsLibrary();
  renderOwnerBans();
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
              <span class="meta-chip">${escapeHtml(result.studentEmail || "بدون بريد")}</span>
              ${result.ipAddress ? `<span class="meta-chip">${escapeHtml(result.ipAddress)}</span>` : ""}
              <span class="meta-chip">${result.totalQuestions} سؤال</span>
              <span class="meta-chip">${Number(result.earnedPoints || 0)} / ${Number(result.totalPoints || 0)} درجة</span>
              <span class="meta-chip">${result.scorePercent === null ? "يدوي" : `${result.scorePercent}%`}</span>
            </div>
            <p class="subtle">
              صحيح: ${result.correct} | قريب: ${result.close || 0} | خطأ: ${result.wrong} | متروك: ${result.skipped} | مراجعة يدوية: ${result.pendingManualReview}
            </p>
            <div class="action-row">
              ${
                result.studentEmail
                  ? `<button class="btn ghost compact-btn" data-owner-action="ban-email" data-value="${escapeHtml(result.studentEmail)}" type="button">حظر البريد</button>`
                  : ""
              }
              ${
                result.ipAddress
                  ? `<button class="btn ghost compact-btn" data-owner-action="ban-ip" data-value="${escapeHtml(result.ipAddress)}" type="button">حظر IP</button>`
                  : ""
              }
            </div>
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

  el.ownerResultsList.querySelectorAll("[data-owner-action='ban-email']").forEach((button) => {
    button.addEventListener("click", () => quickBan("email", button.dataset.value));
  });
  el.ownerResultsList.querySelectorAll("[data-owner-action='ban-ip']").forEach((button) => {
    button.addEventListener("click", () => quickBan("ip", button.dataset.value));
  });
}

function applySubjectLibrary(subjects) {
  const normalized = Array.isArray(subjects) ? subjects : [];
  state.owner.subjects = normalized;
  state.student.materials = normalized;
  renderMaterialsLibrary();
  renderStudentMaterials();
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) {
    return "";
  }

  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
  }

  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function renderSummaryDownload(summary) {
  if (!summary?.hasFile || !summary?.downloadUrl) {
    return "";
  }

  const sizeLabel = formatFileSize(summary.fileSize);
  return `
    <div class="action-row compact-actions">
      <a class="btn ghost compact-btn" href="${escapeHtml(summary.downloadUrl)}" download>تحميل الملف</a>
      ${summary.fileName ? `<span class="meta-chip">${escapeHtml(summary.fileName)}</span>` : ""}
      ${sizeLabel ? `<span class="meta-chip">${escapeHtml(sizeLabel)}</span>` : ""}
    </div>
  `;
}

function updateSummaryFileChip() {
  const file = el.summaryFileInput.files?.[0];
  if (!file) {
    el.summaryFileChip.textContent = "ارفع ملف الملخص ليظهر للطلاب كزر تحميل مباشر.";
    return;
  }

  const sizeMb = (file.size / 1024 / 1024).toFixed(2);
  el.summaryFileChip.textContent = `تم اختيار الملف ${file.name} • ${sizeMb}MB • سيصبح قابلاً للتحميل بعد الحفظ.`;
}

function resetSummaryEditor() {
  state.owner.editingSummaryId = "";
  el.subjectNameInput.value = "";
  el.subjectDescriptionInput.value = "";
  el.sectionNameInput.value = "";
  el.summaryTitleInput.value = "";
  el.summaryTextInput.value = "";
  el.summaryFileInput.value = "";
  updateSummaryFileChip();
  el.summaryStatus.textContent = "جاهز لإضافة مادة أو ملخص جديد.";
  const saveLabel = document.getElementById("saveSummaryBtn");
  if (saveLabel) {
    saveLabel.textContent = "حفظ الملخص";
  }
}

function findSummaryInState(summaryId) {
  for (const subject of state.owner.subjects) {
    for (const section of subject.sections || []) {
      const summary = (section.summaries || []).find((item) => item.id === summaryId);
      if (summary) {
        return { subject, section, summary };
      }
    }
  }

  return null;
}

function renderMaterialsLibrary() {
  if (!el.ownerMaterialsList) {
    return;
  }

  if (!state.owner.subjects.length) {
    el.ownerMaterialsList.innerHTML = `
      <div class="empty-card">
        <p>لا توجد مواد أو ملخصات حتى الآن.</p>
      </div>
    `;
    return;
  }

  el.ownerMaterialsList.innerHTML = state.owner.subjects
    .map(
      (subject) => `
        <article class="exam-card">
          <div class="exam-card-main">
            <div class="question-heading">
              <h3>${escapeHtml(subject.name)}</h3>
              <div class="action-row compact-actions">
                <button class="btn ghost compact-btn" data-material-action="edit-subject" data-id="${subject.id}" type="button">تعديل المادة</button>
                <button class="btn danger compact-btn" data-material-action="delete-subject" data-id="${subject.id}" type="button">حذف المادة</button>
              </div>
            </div>
            ${subject.description ? `<p class="subtle">${escapeHtml(subject.description)}</p>` : ""}
            ${(subject.sections || [])
              .map(
                (section) => `
                  <div class="subtle-box library-section">
                    <div class="question-heading">
                      <strong>${escapeHtml(section.name)}</strong>
                      <div class="action-row compact-actions">
                        <button class="btn ghost compact-btn" data-material-action="edit-section" data-id="${section.id}" type="button">تعديل القسم</button>
                        <button class="btn danger compact-btn" data-material-action="delete-section" data-id="${section.id}" type="button">حذف القسم</button>
                      </div>
                    </div>
                    <div class="question-preview-list compact-list">
                      ${(section.summaries || [])
                        .map(
                          (summary) => `
                            <article class="preview-question compact-summary">
                              <div class="question-heading">
                                <h4>${escapeHtml(summary.title)}</h4>
                                <div class="action-row compact-actions">
                                  <button class="btn ghost compact-btn" data-material-action="edit-summary" data-id="${summary.id}" type="button">تعديل</button>
                                  <button class="btn danger compact-btn" data-material-action="delete-summary" data-id="${summary.id}" type="button">حذف</button>
                                </div>
                              </div>
                              <p class="subtle">${summary.hasFile ? "جاهز للتحميل للطلاب." : "ارفع ملفاً لهذا الملخص."}</p>
                              ${renderSummaryDownload(summary)}
                            </article>
                          `,
                        )
                        .join("") || `<div class="empty-card"><p>لا توجد ملخصات داخل هذا القسم.</p></div>`}
                    </div>
                  </div>
                `,
              )
              .join("")}
          </div>
        </article>
      `,
    )
    .join("");

  el.ownerMaterialsList.querySelectorAll("[data-material-action]").forEach((button) => {
    button.addEventListener("click", () => onMaterialAction(button.dataset.materialAction, button.dataset.id));
  });
}

function renderStudentMaterials() {
  if (!el.studentMaterialList) {
    return;
  }

  if (!state.student.materials.length) {
    el.studentMaterialList.innerHTML = `
      <div class="empty-card">
        <p>لا توجد ملخصات مواد منشورة حتى الآن.</p>
      </div>
    `;
    return;
  }

  el.studentMaterialList.innerHTML = state.student.materials
    .map(
      (subject) => `
        <article class="exam-card">
          <div class="exam-card-main">
            <h3>${escapeHtml(subject.name)}</h3>
            ${subject.description ? `<p class="subtle">${escapeHtml(subject.description)}</p>` : ""}
            ${(subject.sections || [])
              .map(
                (section) => `
                  <details class="result-details">
                    <summary>${escapeHtml(section.name)}</summary>
                    <div class="question-preview-list compact-list">
                      ${(section.summaries || [])
                        .map(
                          (summary) => `
                            <article class="preview-question compact-summary">
                              <h4>${escapeHtml(summary.title)}</h4>
                              <p class="subtle">هذا الملخص متاح كملف تحميل فقط.</p>
                              ${renderSummaryDownload(summary)}
                            </article>
                          `,
                        )
                        .join("")}
                    </div>
                  </details>
                `,
              )
              .join("")}
          </div>
        </article>
      `,
    )
    .join("");
}

function renderOwnerBans() {
  if (!el.ownerBanList) {
    return;
  }

  if (!state.owner.bans.length) {
    el.ownerBanList.innerHTML = `
      <div class="empty-card">
        <p>لا توجد عناصر حظر حتى الآن.</p>
      </div>
    `;
    return;
  }

  el.ownerBanList.innerHTML = state.owner.bans
    .map(
      (ban) => `
        <article class="exam-card">
          <div class="exam-card-main">
            <h3>${
              ban.type === "ip"
                ? "حظر IP"
                : ban.type === "device"
                  ? "حظر جهاز"
                  : "حظر بريد إلكتروني"
            }</h3>
            <div class="meta-row">
              <span class="meta-chip">${escapeHtml(ban.value)}</span>
              <span class="meta-chip">${escapeHtml(ban.createdAt || "")}</span>
            </div>
            ${ban.reason ? `<p class="subtle">${escapeHtml(ban.reason)}</p>` : ""}
          </div>
          <div class="action-row">
            <button class="btn danger compact-btn" data-ban-delete="${ban.id}" type="button">حذف الحظر</button>
          </div>
        </article>
      `,
    )
    .join("");

  el.ownerBanList.querySelectorAll("[data-ban-delete]").forEach((button) => {
    button.addEventListener("click", () => removeBan(button.dataset.banDelete));
  });
}

async function saveSummary(event) {
  event.preventDefault();

  if (!state.owner.authenticated) {
    openOwnerModal();
    return;
  }

  const formData = new FormData();
  formData.append("subjectName", el.subjectNameInput.value.trim());
  formData.append("subjectDescription", el.subjectDescriptionInput.value.trim());
  formData.append("sectionName", el.sectionNameInput.value.trim());
  formData.append("summaryTitle", el.summaryTitleInput.value.trim());
  formData.append("summaryText", el.summaryTextInput?.value?.trim() || "");
  const summaryFile = el.summaryFileInput.files?.[0];
  if (summaryFile) {
    formData.append("summaryFile", summaryFile);
  }

  const isEditing = Boolean(state.owner.editingSummaryId);
  const url = isEditing ? `/api/admin/summaries/${state.owner.editingSummaryId}` : "/api/admin/summaries";

  try {
    el.summaryStatus.textContent = isEditing ? "جارٍ حفظ تعديل الملخص..." : "جارٍ حفظ الملخص...";
    const data = await request(url, {
      method: isEditing ? "PUT" : "POST",
      body: formData,
      headers: ownerHeaders(),
    });
    applySubjectLibrary(data.subjects);
    resetSummaryEditor();
    el.summaryStatus.textContent = data.message;
    toast(data.message);
  } catch (error) {
    el.summaryStatus.textContent = error.message;
    toast(error.message);
  }
}

async function addBan(event) {
  event.preventDefault();

  try {
    el.banStatus.textContent = "جارٍ حفظ الحظر...";
    const data = await request("/api/admin/bans", {
      method: "POST",
      json: {
        type: el.banTypeInput.value,
        value: el.banValueInput.value.trim(),
        reason: el.banReasonInput.value.trim(),
      },
      headers: ownerHeaders(),
    });
    state.owner.bans = Array.isArray(data.bans) ? data.bans : [];
    renderOwnerBans();
    el.banValueInput.value = "";
    el.banReasonInput.value = "";
    el.banStatus.textContent = data.message;
    toast(data.message);
  } catch (error) {
    el.banStatus.textContent = error.message;
    toast(error.message);
  }
}

async function removeBan(banId) {
  try {
    const data = await request(`/api/admin/bans/${banId}`, {
      method: "DELETE",
      headers: ownerHeaders(),
    });
    state.owner.bans = Array.isArray(data.bans) ? data.bans : [];
    renderOwnerBans();
    el.banStatus.textContent = data.message;
    toast(data.message);
  } catch (error) {
    toast(error.message);
  }
}

async function quickBan(type, value) {
  el.banTypeInput.value = type;
  el.banValueInput.value = value || "";
  showView("owner");
  try {
    el.banStatus.textContent = "جارٍ حفظ الحظر...";
    const data = await request("/api/admin/bans", {
      method: "POST",
      json: {
        type,
        value,
        reason: "",
      },
      headers: ownerHeaders(),
    });
    state.owner.bans = Array.isArray(data.bans) ? data.bans : [];
    renderOwnerBans();
    el.banStatus.textContent = data.message;
    toast(data.message);
  } catch (error) {
    el.banReasonInput.focus();
    toast(error.message);
  }
}

async function onMaterialAction(action, id) {
  if (action === "edit-summary") {
    const match = findSummaryInState(id);
    if (!match) {
      return;
    }

    state.owner.editingSummaryId = id;
    el.subjectNameInput.value = match.subject.name || "";
    el.subjectDescriptionInput.value = match.subject.description || "";
    el.sectionNameInput.value = match.section.name || "";
    el.summaryTitleInput.value = match.summary.title || "";
    if (el.summaryTextInput) {
      el.summaryTextInput.value = match.summary.text || "";
    }
    el.summaryFileInput.value = "";
    if (match.summary.hasFile && match.summary.fileName) {
      const currentFileSize = formatFileSize(match.summary.fileSize);
      el.summaryFileChip.textContent = `الملف الحالي: ${match.summary.fileName}${currentFileSize ? ` • ${currentFileSize}` : ""} • ارفع ملفاً جديداً فقط إذا أردت استبداله.`;
    } else {
      updateSummaryFileChip();
    }
    el.summaryStatus.textContent = "يمكنك الآن تعديل هذا الملخص ثم حفظه.";
    document.getElementById("saveSummaryBtn").textContent = "حفظ التعديلات";
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  if (action === "delete-summary") {
    try {
      const data = await request(`/api/admin/summaries/${id}`, {
        method: "DELETE",
        headers: ownerHeaders(),
      });
      applySubjectLibrary(data.subjects);
      toast(data.message);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  if (action === "edit-subject") {
    const subject = state.owner.subjects.find((item) => item.id === id);
    if (!subject) {
      return;
    }

    const name = window.prompt("اسم المادة الجديد", subject.name || "");
    if (!name) {
      return;
    }
    const description = window.prompt("وصف المادة", subject.description || "") ?? subject.description;
    try {
      const data = await request(`/api/admin/subjects/${id}`, {
        method: "PUT",
        json: { name, description },
        headers: ownerHeaders(),
      });
      applySubjectLibrary(data.subjects);
      toast(data.message);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  if (action === "delete-subject") {
    try {
      const data = await request(`/api/admin/subjects/${id}`, {
        method: "DELETE",
        headers: ownerHeaders(),
      });
      applySubjectLibrary(data.subjects);
      toast(data.message);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  if (action === "edit-section") {
    const location = state.owner.subjects
      .flatMap((subject) => (subject.sections || []).map((section) => ({ subject, section })))
      .find((item) => item.section.id === id);
    if (!location) {
      return;
    }

    const name = window.prompt("اسم القسم الجديد", location.section.name || "");
    if (!name) {
      return;
    }

    try {
      const data = await request(`/api/admin/sections/${id}`, {
        method: "PUT",
        json: { name },
        headers: ownerHeaders(),
      });
      applySubjectLibrary(data.subjects);
      toast(data.message);
    } catch (error) {
      toast(error.message);
    }
    return;
  }

  if (action === "delete-section") {
    try {
      const data = await request(`/api/admin/sections/${id}`, {
        method: "DELETE",
        headers: ownerHeaders(),
      });
      applySubjectLibrary(data.subjects);
      toast(data.message);
    } catch (error) {
      toast(error.message);
    }
  }
}

function renderStudentArea() {
  syncStudentIdentityFields();
  renderStudentMaterials();

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
    actionLabel: hasValidStudentIdentity() ? "بدء الامتحان" : "أكمل الاسم والإيميل أولاً",
    actionDisabled: !hasValidStudentIdentity(),
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
              <span class="meta-chip">${exam.totalPoints || exam.questionCount} درجة</span>
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

function buildFileSummary(file) {
  const sizeMb = (file.size / 1024 / 1024).toFixed(2);
  return `${file.name} • ${sizeMb}MB`;
}

function updateFileChip() {
  const file = el.examFileInput.files?.[0];
  if (!file) {
    el.fileChip.textContent = "لم يتم اختيار أي ملف بعد.";
    return;
  }

  el.fileChip.textContent = buildFileSummary(file);
  return;

  const sizeMb = (file.size / 1024 / 1024).toFixed(2);
  el.fileChip.textContent = `${file.name} • ${sizeMb}MB`;
}

function updateMaterialFileChip() {
  const files = Array.from(el.materialFileInput.files || []);
  if (!files.length) {
    el.materialFileChip.textContent = "لم يتم اختيار ملفات مادة بعد.";
    return;
  }

  if (files.length === 1) {
    el.materialFileChip.textContent = buildFileSummary(files[0]);
    return;
  }

  el.materialFileChip.textContent = `${files.length} ملفات مادة جاهزة للمعالجة`;
}

async function processExam(event) {
  event.preventDefault();

  if (!state.owner.authenticated) {
    openOwnerModal();
    return;
  }

  const manualText = el.manualTextInput.value.trim();
  const file = el.examFileInput.files?.[0];
  const materialText = el.materialTextInput.value.trim();
  const materialFiles = Array.from(el.materialFileInput.files || []);

  if (!file && !manualText) {
    toast("ارفع ملفاً أو الصق النص قبل التحليل.");
    return;
  }

  const formData = new FormData();
  if (file) {
    formData.append("examFile", file);
  }
  materialFiles.forEach((materialFile) => {
    formData.append("materialFiles", materialFile);
  });
  formData.append("manualText", manualText);
  formData.append("materialText", materialText);
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
  el.previewMaterialSources.textContent = Array.isArray(preview.materialSources) && preview.materialSources.length
    ? preview.materialSources.join(" • ")
    : "لا توجد مراجع مادة مرفوعة لهذا الامتحان.";

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
  el.previewMaterialSources.textContent = "لا توجد مراجع مادة مرفوعة لهذا الامتحان.";
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
    materialSources: Array.isArray(state.owner.preview.materialSources) ? state.owner.preview.materialSources : [],
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
    el.materialTextInput.value = "";
    el.instructionsInput.value = "";
    el.durationInput.value = "60";
    el.examFileInput.value = "";
    el.materialFileInput.value = "";
    updateFileChip();
    updateMaterialFileChip();
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
      materialSources: [],
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
  if (!ensureStudentIdentity()) {
    return;
  }

  try {
    const data = await request(`/api/exams/${examId}?studentEmail=${encodeURIComponent(state.student.email)}`);
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

function getQuestionTranslationKey(question) {
  return `${state.student.exam?.id || "exam"}:${question.id}`;
}

function getTranslationTargetLang(question) {
  const combined = `${question.questionText || ""} ${(question.options || []).join(" ")}`;
  return /[\u0600-\u06FF]/u.test(combined) ? "en" : "ar";
}

function getQuestionTranslation(question) {
  const key = getQuestionTranslationKey(question);
  return {
    key,
    data: state.student.translations[key] || null,
    visible: Boolean(state.student.translationVisible[key]),
    loading: state.student.translationLoadingKey === key,
  };
}

async function toggleQuestionTranslation(question) {
  const translationState = getQuestionTranslation(question);
  if (translationState.loading) {
    return;
  }

  if (translationState.data) {
    state.student.translationVisible[translationState.key] = !translationState.visible;
    renderStudentExam();
    return;
  }

  const texts = [question.questionText, ...(Array.isArray(question.options) ? question.options : [])].filter(Boolean);
  if (!texts.length) {
    return;
  }

  try {
    state.student.translationLoadingKey = translationState.key;
    renderStudentExam();
    const data = await request("/api/translate", {
      method: "POST",
      json: {
        studentEmail: state.student.email,
        targetLang: getTranslationTargetLang(question),
        texts,
      },
    });
    state.student.translations[translationState.key] = {
      questionText: data.translations?.[0] || "",
      options: Array.isArray(data.translations) ? data.translations.slice(1) : [],
    };
    state.student.translationVisible[translationState.key] = true;
  } catch (error) {
    toast(error.message);
  } finally {
    state.student.translationLoadingKey = "";
    renderStudentExam();
  }
}

function renderStudentExam() {
  if (!state.student.exam) {
    return;
  }

  const exam = state.student.exam;
  const question = exam.questions[state.student.currentIndex];
  const translation = getQuestionTranslation(question);
  const translateLabel = translation.loading
    ? "جارٍ الترجمة..."
    : translation.visible
      ? "إخفاء الترجمة"
      : translation.data
        ? "إظهار الترجمة"
        : "ترجمة السؤال والإجابات";

  el.studentCurrentName.textContent = state.student.name || "-";
  el.studentCurrentEmail.textContent = state.student.email || "-";
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
        <div class="subtle">سؤال ${state.student.currentIndex + 1} من ${exam.questions.length} • ${question.points || 1} درجة</div>
        <div class="action-row compact-actions">
          <span class="type-chip ${question.type}">${escapeHtml(getQuestionTypeLabel(question.type))}</span>
          <button class="btn ghost compact-btn" data-translate-question="true" type="button" ${translation.loading ? "disabled" : ""}>${translateLabel}</button>
        </div>
      </div>
      <h4>${escapeHtml(question.questionText)}</h4>
      ${
        translation.visible && translation.data?.questionText
          ? `<div class="translated-box">${escapeHtml(translation.data.questionText)}</div>`
          : ""
      }
      ${renderStudentAnswerInput(question, state.student.answers[state.student.currentIndex], translation.visible ? translation.data : null)}
    </article>
  `;

  const translateButton = el.questionCard.querySelector("[data-translate-question]");
  if (translateButton) {
    translateButton.addEventListener("click", () => toggleQuestionTranslation(question));
  }

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

function renderStudentAnswerInput(question, currentAnswer, translation) {
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
              <span class="option-copy">
                <span>${escapeHtml(option)}</span>
                ${
                  translation?.options?.[optionIndex]
                    ? `<span class="option-subtext">${escapeHtml(translation.options[optionIndex])}</span>`
                    : ""
                }
              </span>
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
  el.resultClose.textContent = String(result.close || 0);
  el.resultWrong.textContent = String(result.wrong);
  el.resultSkipped.textContent = String(result.skipped);
  el.resultPoints.textContent = `${Number(result.earnedPoints || 0)} / ${Number(result.totalPoints || 0)}`;

  el.reviewList.innerHTML = result.review
    .map((question, index) => renderReviewQuestion(question, index))
    .join("");
}

function buildResultSummary(result) {
  if (result.scorePercent === null) {
    return `${result.studentName}، تم استلام إجاباتك. هذا الامتحان يحتوي على أسئلة كتابية تحتاج مراجعة يدوية.`;
  }

  if (result.pendingManualReview) {
    return `${result.studentName}، نتيجتك الحالية ${result.scorePercent}% ودرجاتك ${Number(result.earnedPoints || 0)} من ${Number(result.gradablePoints || 0)} في الأسئلة المصححة تلقائياً، وتبقت ${result.pendingManualReview} أسئلة للمراجعة.`;
  }

  return `${result.studentName}، حصلت على ${Number(result.earnedPoints || 0)} من ${Number(result.totalPoints || 0)} درجة بنسبة ${result.scorePercent || 0}%، وفيها ${result.correct} صحيح و${result.close || 0} قريب.`;
}

function createEditableQuestion(type = "multiple_choice") {
  if (type === "short_answer") {
    return {
      type,
      points: 1,
      questionText: "",
      options: [],
      correctAnswerIndex: null,
      correctAnswerText: "",
      gradingKeywords: [],
      referenceText: "",
      sourceLabel: "",
      placeholder: "اكتب إجابتك هنا",
      explanation: "",
    };
  }

  const options = type === "true_false" ? ["صح", "خطأ"] : ["الخيار الأول", "الخيار الثاني"];
  return {
    type,
    points: 1,
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
  converted.points = Number(question.points || 1) || 1;
  converted.questionText = question.questionText || "";
  converted.explanation = question.explanation || "";

  if (nextType === "short_answer") {
    converted.correctAnswerText = question.correctAnswerText || "";
    converted.gradingKeywords = Array.isArray(question.gradingKeywords) ? question.gradingKeywords : [];
    converted.referenceText = question.referenceText || "";
    converted.sourceLabel = question.sourceLabel || "";
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

  if (field === "points") {
    question.points = Math.max(1, Math.min(100, Number(event.target.value || 1)));
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

  if (field === "gradingKeywords") {
    question.gradingKeywords = event.target.value
      .split(/[\n,،]/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 8);
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

      <label class="field">
        <span>درجة السؤال</span>
        <input type="number" min="1" max="100" data-preview-field="points" data-question-index="${index}" value="${escapeHtml(question.points || 1)}">
      </label>

      ${
        isShortAnswer
          ? `
            <label class="field">
              <span>الإجابة المتوقعة</span>
              <input type="text" data-preview-field="correctAnswerText" data-question-index="${index}" value="${escapeHtml(question.correctAnswerText || "")}">
            </label>
            <label class="field">
              <span>ÙƒÙ„Ù…Ø§Øª Ù…ÙØªØ§Ø­ÙŠØ© Ù„Ù„ØªØµØ­ÙŠØ­</span>
              <textarea rows="2" data-preview-field="gradingKeywords" data-question-index="${index}">${escapeHtml((question.gradingKeywords || []).join("ØŒ "))}</textarea>
            </label>
            <label class="field">
              <span>Ù…Ø±Ø¬Ø¹ Ù…Ù† Ù…Ù„ÙØ§Øª Ø§Ù„Ù…Ø§Ø¯Ø©</span>
              <textarea rows="3" data-preview-field="referenceText" data-question-index="${index}">${escapeHtml(question.referenceText || "")}</textarea>
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

state.owner.visitors = Array.isArray(state.owner.visitors) ? state.owner.visitors : [];
state.student.visitorSessionId = window.localStorage.getItem("exam-visitor-session-id") || "";
state.student.visitorSyncTimer = 0;
state.student.visitorIdentitySignature = "";

const originalCacheElements = cacheElements;
cacheElements = function enhancedCacheElements() {
  originalCacheElements();
  ensureOwnerVisitorPanel();
  el.ownerVisitorList = document.getElementById("ownerVisitorList");
};

const originalInit = init;
init = async function enhancedInit() {
  ensureVisitorSessionId();
  await originalInit();
  try {
    await registerVisitorSession("page_open");
  } catch (error) {
    console.error(error);
  }
};

const originalLogoutOwner = logoutOwner;
logoutOwner = function enhancedLogoutOwner() {
  state.owner.visitors = [];
  originalLogoutOwner();
  renderOwnerVisitors();
};

refreshOwnerPlatform = async function enhancedRefreshOwnerPlatform() {
  if (!state.owner.authenticated) {
    state.owner.subjects = [];
    state.owner.bans = [];
    state.owner.visitors = [];
    renderMaterialsLibrary();
    renderOwnerBans();
    renderOwnerVisitors();
    return;
  }

  const data = await request("/api/admin/platform", {
    headers: ownerHeaders(),
  });
  state.owner.subjects = Array.isArray(data.subjects) ? data.subjects : [];
  state.owner.bans = Array.isArray(data.bans) ? data.bans : [];
  state.owner.visitors = Array.isArray(data.visitors) ? data.visitors : [];
  renderMaterialsLibrary();
  renderOwnerBans();
  renderOwnerVisitors();
};

const originalOnStudentNameInput = onStudentNameInput;
onStudentNameInput = function enhancedOnStudentNameInput(event) {
  originalOnStudentNameInput(event);
  scheduleVisitorIdentitySync();
};

const originalOnStudentEmailInput = onStudentEmailInput;
onStudentEmailInput = function enhancedOnStudentEmailInput(event) {
  originalOnStudentEmailInput(event);
  scheduleVisitorIdentitySync();
};

const originalStartExam = startExam;
startExam = async function enhancedStartExam(examId) {
  try {
    await registerVisitorSession("identity_update");
  } catch (error) {
    console.error(error);
  }
  return originalStartExam(examId);
};

function ensureOwnerVisitorPanel() {
  let existing = document.getElementById("ownerVisitorList");
  if (existing) {
    el.ownerVisitorList = existing;
    return;
  }

  const ownerResultsList = document.getElementById("ownerResultsList");
  const ownerResultsPanel = ownerResultsList?.closest(".panel");
  if (!ownerResultsPanel) {
    return;
  }

  const section = document.createElement("section");
  section.className = "panel";
  section.innerHTML = `
    <div class="section-head">
      <div>
        <h3>سجل الزوار</h3>
        <p class="subtle">كل من يفتح الرابط يظهر هنا مع IP ومعلومات الجهاز.</p>
      </div>
    </div>

    <div id="ownerVisitorList" class="exam-list empty-state">
      <div class="empty-card">
        <p>لا توجد زيارات مسجلة حتى الآن.</p>
      </div>
    </div>
  `;

  ownerResultsPanel.insertAdjacentElement("afterend", section);
  existing = section.querySelector("#ownerVisitorList");
  el.ownerVisitorList = existing;
}

function createVisitorSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureVisitorSessionId() {
  if (!state.student.visitorSessionId) {
    state.student.visitorSessionId = window.localStorage.getItem("exam-visitor-session-id") || createVisitorSessionId();
    window.localStorage.setItem("exam-visitor-session-id", state.student.visitorSessionId);
  }
  return state.student.visitorSessionId;
}

function buildClientVisitorContext(reason = "page_open") {
  const userAgent = navigator.userAgent || "";
  const language = navigator.language || "";
  const languages = Array.isArray(navigator.languages) ? navigator.languages.slice(0, 6) : language ? [language] : [];
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  const screenSize = window.screen ? `${window.screen.width}x${window.screen.height}` : "";
  const viewport = `${window.innerWidth || 0}x${window.innerHeight || 0}`;

  return {
    sessionId: ensureVisitorSessionId(),
    studentName: state.student.name,
    studentEmail: isValidEmail(state.student.email) ? state.student.email : "",
    userAgent,
    platform: navigator.userAgentData?.platform || navigator.platform || "",
    deviceModel: navigator.userAgentData?.model || "",
    language,
    languages,
    timeZone,
    screen: screenSize,
    viewport,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    deviceMemory: navigator.deviceMemory || 0,
    touchPoints: navigator.maxTouchPoints || 0,
    pageUrl: window.location.href,
    referrer: document.referrer || "",
    reason,
  };
}

async function registerVisitorSession(reason = "page_open") {
  const payload = buildClientVisitorContext(reason);
  const identitySignature = `${payload.studentName || ""}|${payload.studentEmail || ""}`;

  if (reason === "identity_update" && identitySignature === state.student.visitorIdentitySignature) {
    return null;
  }

  const data = await request("/api/visitors/session", {
    method: "POST",
    json: payload,
  });

  if (reason === "page_open" || reason === "identity_update") {
    state.student.visitorIdentitySignature = identitySignature;
  }

  return data;
}

function scheduleVisitorIdentitySync() {
  window.clearTimeout(state.student.visitorSyncTimer);
  state.student.visitorSyncTimer = window.setTimeout(() => {
    registerVisitorSession("identity_update").catch((error) => {
      console.error(error);
    });
  }, 650);
}

function formatVisitorDeviceType(deviceType) {
  switch (String(deviceType || "").toLowerCase()) {
    case "mobile":
      return "جوال";
    case "tablet":
      return "تابلت";
    default:
      return "كمبيوتر";
  }
}

function getVisitorHeadline(visitor) {
  return visitor.studentName || visitor.studentEmail || visitor.ipAddress || "زائر جديد";
}

function renderOwnerVisitors() {
  if (!el.ownerVisitorList) {
    return;
  }

  if (!Array.isArray(state.owner.visitors) || !state.owner.visitors.length) {
    el.ownerVisitorList.innerHTML = `
      <div class="empty-card">
        <p>لا توجد زيارات مسجلة حتى الآن.</p>
      </div>
    `;
    return;
  }

  el.ownerVisitorList.innerHTML = state.owner.visitors
    .map(
      (visitor) => `
        <article class="exam-card">
          <div class="exam-card-main">
            <div class="question-heading">
              <h3>${escapeHtml(getVisitorHeadline(visitor))}</h3>
              <div class="action-row compact-actions">
                <span class="type-chip">${escapeHtml(formatVisitorDeviceType(visitor.deviceType))}</span>
                ${
                  visitor.bannedByEmail || visitor.bannedByIp || visitor.bannedByDevice
                    ? `<span class="type-chip short_answer">محظور</span>`
                    : ""
                }
              </div>
            </div>

            <div class="meta-row">
              ${visitor.lastSeen ? `<span class="meta-chip">آخر دخول: ${escapeHtml(visitor.lastSeen)}</span>` : ""}
              ${visitor.ipAddress ? `<span class="meta-chip">${escapeHtml(visitor.ipAddress)}</span>` : ""}
              ${visitor.deviceId ? `<span class="meta-chip">${escapeHtml(visitor.deviceId)}</span>` : ""}
              ${visitor.studentEmail ? `<span class="meta-chip">${escapeHtml(visitor.studentEmail)}</span>` : ""}
              ${visitor.country ? `<span class="meta-chip">${escapeHtml(visitor.country)}</span>` : ""}
              <span class="meta-chip">الزيارات: ${Number(visitor.visitCount || 0)}</span>
            </div>

            <div class="visitor-grid">
              <div class="subtle-box visitor-detail">
                <strong>الجهاز</strong>
                <p>${escapeHtml(visitor.deviceSummary || formatVisitorDeviceType(visitor.deviceType))}</p>
              </div>
              <div class="subtle-box visitor-detail">
                <strong>اللغة والمنطقة</strong>
                <p>${escapeHtml([visitor.language, visitor.timeZone].filter(Boolean).join(" • ") || "غير متوفر")}</p>
              </div>
              <div class="subtle-box visitor-detail">
                <strong>الشاشة</strong>
                <p>${escapeHtml([visitor.screen, visitor.viewport].filter(Boolean).join(" • ") || "غير متوفر")}</p>
              </div>
            </div>

            ${
              visitor.pageUrl || visitor.referrer || visitor.userAgent
                ? `
                  <details class="result-details">
                    <summary>تفاصيل إضافية</summary>
                    <div class="question-preview-list compact-list">
                      ${
                        visitor.pageUrl
                          ? `<div class="answer-box"><strong>الرابط:</strong> <span class="mono-text">${escapeHtml(visitor.pageUrl)}</span></div>`
                          : ""
                      }
                      ${
                        visitor.referrer
                          ? `<div class="answer-box"><strong>المصدر:</strong> <span class="mono-text">${escapeHtml(visitor.referrer)}</span></div>`
                          : ""
                      }
                      ${
                        visitor.userAgent
                          ? `<div class="answer-box"><strong>User-Agent:</strong> <span class="mono-text">${escapeHtml(visitor.userAgent)}</span></div>`
                          : ""
                      }
                    </div>
                  </details>
                `
                : ""
            }
          </div>

          <div class="action-row">
            ${
              visitor.studentEmail && !visitor.bannedByEmail
                ? `<button class="btn ghost compact-btn" data-visitor-action="ban-email" data-value="${escapeHtml(visitor.studentEmail)}" type="button">حظر البريد</button>`
                : ""
            }
            ${
              visitor.ipAddress && !visitor.bannedByIp
                ? `<button class="btn ghost compact-btn" data-visitor-action="ban-ip" data-value="${escapeHtml(visitor.ipAddress)}" type="button">حظر IP</button>`
                : ""
            }
            ${
              visitor.deviceId && !visitor.bannedByDevice
                ? `<button class="btn ghost compact-btn" data-visitor-action="ban-device" data-value="${escapeHtml(visitor.deviceId)}" type="button">حظر الجهاز</button>`
                : ""
            }
          </div>
        </article>
      `,
    )
    .join("");

  el.ownerVisitorList.querySelectorAll("[data-visitor-action='ban-email']").forEach((button) => {
    button.addEventListener("click", () => quickBan("email", button.dataset.value));
  });
  el.ownerVisitorList.querySelectorAll("[data-visitor-action='ban-ip']").forEach((button) => {
    button.addEventListener("click", () => quickBan("ip", button.dataset.value));
  });
  el.ownerVisitorList.querySelectorAll("[data-visitor-action='ban-device']").forEach((button) => {
    button.addEventListener("click", () => quickBan("device", button.dataset.value));
  });
}

function renderReviewQuestion(question, index) {
  const isPending = question.pendingManualReview;
  const cardStateClass = isPending ? "pending" : question.evaluation === "close" ? "close" : question.isCorrect ? "correct" : "wrong";
  const classes = ["preview-question", "review-card", cardStateClass].filter(Boolean).join(" ");
  const userAnswerText = getUserAnswerLabel(question);
  const correctAnswerText = getCorrectAnswerLabel(question);
  const hasObjectiveOptions = Array.isArray(question.options) && question.options.length >= 2;

  return `
    <article class="${classes}">
      <div class="question-heading">
        <div class="subtle">سؤال ${index + 1} • ${question.points || 1} درجة</div>
        <span class="type-chip ${question.type}">${escapeHtml(getQuestionTypeLabel(question.type))}</span>
      </div>
      <h4>${escapeHtml(question.questionText)}</h4>
      <div class="answer-chip ${getReviewChipClass(question)}">${escapeHtml(userAnswerText)}</div>
      <div class="meta-row">
        <span class="meta-chip">الدرجة: ${Number(question.earnedPoints || 0)} / ${Number(question.points || 0)}</span>
        ${
          question.evaluation && question.evaluation !== "pending"
            ? `<span class="meta-chip">${escapeHtml(getEvaluationLabel(question.evaluation))}</span>`
            : ""
        }
      </div>
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
      ${
        !hasObjectiveOptions && question.referenceText
          ? `<div class="answer-box subtle-box">مرجع المادة: ${escapeHtml(question.referenceText)}</div>`
          : ""
      }
      ${
        !hasObjectiveOptions && Array.isArray(question.gradingKeywords) && question.gradingKeywords.length
          ? `<p class="subtle">الكلمات المفتاحية: ${escapeHtml(question.gradingKeywords.join("، "))}</p>`
          : ""
      }
      ${
        !hasObjectiveOptions && Array.isArray(question.matchedKeywords) && question.matchedKeywords.length
          ? `<p class="subtle">الكلمات المطابقة من إجابتك: ${escapeHtml(question.matchedKeywords.join("، "))}</p>`
          : ""
      }
      <div class="${isPending ? "pending-label" : "review-label"}">
        ${isPending ? "بانتظار مراجعة السؤال الكتابي." : `الإجابة الصحيحة: ${escapeHtml(correctAnswerText)}`}
      </div>
      ${
        question.feedback
          ? `<p>${escapeHtml(question.feedback)}</p>`
          : question.explanation
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

  if (question.evaluation === "close") {
    return "close";
  }

  if (question.isCorrect === true) {
    return "correct";
  }

  if (question.isCorrect === false) {
    return "wrong";
  }

  return "";
}

function getEvaluationLabel(value) {
  if (value === "correct") {
    return "صحيح";
  }

  if (value === "close") {
    return "قريب";
  }

  if (value === "unanswered") {
    return "بدون إجابة";
  }

  return "خطأ";
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
    return question.correctAnswerText || question.referenceText || "";
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
        studentEmail: state.student.email,
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
  state.student.translations = {};
  state.student.translationVisible = {};
  state.student.translationLoadingKey = "";
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

function updateSummaryFileChip() {
  const file = el.summaryFileInput.files?.[0];
  if (!file) {
    el.summaryFileChip.textContent = "ارفع ملف الملخص ليظهر للطلاب كزر تحميل مباشر.";
    return;
  }

  const sizeMb = (file.size / 1024 / 1024).toFixed(2);
  el.summaryFileChip.textContent = `تم اختيار الملف ${file.name} • ${sizeMb}MB • سيصبح قابلاً للتحميل بعد الحفظ.`;
}

// Override the earlier preview renderer to avoid mojibake labels in the owner UI.
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

      <label class="field">
        <span>درجة السؤال</span>
        <input type="number" min="1" max="100" data-preview-field="points" data-question-index="${index}" value="${escapeHtml(question.points || 1)}">
      </label>

      ${
        isShortAnswer
          ? `
            <label class="field">
              <span>الإجابة المتوقعة</span>
              <input type="text" data-preview-field="correctAnswerText" data-question-index="${index}" value="${escapeHtml(question.correctAnswerText || "")}">
            </label>
            <label class="field">
              <span>كلمات مفتاحية للتصحيح</span>
              <textarea rows="2" data-preview-field="gradingKeywords" data-question-index="${index}">${escapeHtml((question.gradingKeywords || []).join("، "))}</textarea>
            </label>
            <label class="field">
              <span>مرجع من ملفات المادة</span>
              <textarea rows="3" data-preview-field="referenceText" data-question-index="${index}">${escapeHtml(question.referenceText || "")}</textarea>
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
