const {
  clearStudentToken,
  ensureDeviceId,
  escapeHtml,
  isValidEmail,
  registerVisitor,
  request,
  setStudentToken,
} = window.PlatformClient;

const authState = {
  activeTab: "login",
};

const authEl = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheAuthElements();
  bindAuthEvents();
  initAuthPage().catch((error) => {
    console.error(error);
    setAuthStatus(error.message || "تعذر فتح الصفحة.", "error");
  });
});

function cacheAuthElements() {
  [
    "authShell",
    "blockedScreen",
    "blockedMessage",
    "authStatus",
    "loginForm",
    "registerForm",
    "loginTabBtn",
    "registerTabBtn",
    "loginEmail",
    "loginPassword",
    "registerName",
    "registerEmail",
    "registerPassword",
    "loginSubmitBtn",
    "registerSubmitBtn",
  ].forEach((id) => {
    authEl[id] = document.getElementById(id);
  });
}

function bindAuthEvents() {
  document.querySelectorAll("[data-tab-target]").forEach((button) => {
    button.addEventListener("click", () => switchAuthTab(button.dataset.tabTarget));
  });

  authEl.loginForm.addEventListener("submit", onLoginSubmit);
  authEl.registerForm.addEventListener("submit", onRegisterSubmit);
}

async function initAuthPage() {
  ensureDeviceId();
  switchAuthTab("login");
  await registerVisitor("page_open");

  try {
    const access = await request("/api/access/status", {
      method: "POST",
      json: {},
    });

    if (access.authenticated) {
      window.location.href = "/student.html";
      return;
    }

    clearStudentToken();
  } catch (error) {
    if (error.status === 403) {
      showBlocked(error.message);
      return;
    }
    clearStudentToken();
  }
}

function switchAuthTab(tab) {
  authState.activeTab = tab === "register" ? "register" : "login";
  authEl.loginTabBtn.classList.toggle("is-active", authState.activeTab === "login");
  authEl.registerTabBtn.classList.toggle("is-active", authState.activeTab === "register");
  authEl.loginForm.classList.toggle("hidden", authState.activeTab !== "login");
  authEl.registerForm.classList.toggle("hidden", authState.activeTab !== "register");
  setAuthStatus("جاهز", "neutral");
}

function setAuthStatus(message, mode = "neutral") {
  authEl.authStatus.textContent = message;
  authEl.authStatus.dataset.mode = mode;
}

function showBlocked(message) {
  authEl.authShell.classList.add("hidden");
  authEl.blockedScreen.classList.remove("hidden");
  authEl.blockedMessage.innerHTML = escapeHtml(message || "أنت محظور يا حلو، امشي شوف قرايتك براك ;)");
}

function setButtonLoading(button, loading) {
  button.disabled = loading;
}

async function onLoginSubmit(event) {
  event.preventDefault();
  const email = authEl.loginEmail.value.trim();
  const password = authEl.loginPassword.value;

  if (!isValidEmail(email)) {
    setAuthStatus("أدخل إيميلاً صحيحاً.", "error");
    return;
  }

  if (!password.trim()) {
    setAuthStatus("أدخل الباس ورد.", "error");
    return;
  }

  setButtonLoading(authEl.loginSubmitBtn, true);
  setAuthStatus("جارٍ تسجيل الدخول...", "neutral");

  try {
    const data = await request("/api/auth/login", {
      method: "POST",
      json: { email, password },
    });
    setStudentToken(data.token);
    await registerVisitor("identity_update", {
      studentName: data.student?.name || "",
      studentEmail: data.student?.email || email,
    });
    window.location.href = "/student.html";
  } catch (error) {
    if (error.status === 403) {
      showBlocked(error.message);
      return;
    }
    setAuthStatus(error.message || "تعذر تسجيل الدخول.", "error");
  } finally {
    setButtonLoading(authEl.loginSubmitBtn, false);
  }
}

async function onRegisterSubmit(event) {
  event.preventDefault();
  const name = authEl.registerName.value.trim();
  const email = authEl.registerEmail.value.trim();
  const password = authEl.registerPassword.value;

  if (!name) {
    setAuthStatus("اكتب الاسم أولاً.", "error");
    return;
  }

  if (!isValidEmail(email)) {
    setAuthStatus("أدخل إيميلاً صحيحاً.", "error");
    return;
  }

  if (password.trim().length < 6) {
    setAuthStatus("الباس ورد لازم يكون 6 أحرف أو أكثر.", "error");
    return;
  }

  setButtonLoading(authEl.registerSubmitBtn, true);
  setAuthStatus("جارٍ إنشاء الحساب...", "neutral");

  try {
    const data = await request("/api/auth/register", {
      method: "POST",
      json: { name, email, password },
    });
    setStudentToken(data.token);
    await registerVisitor("identity_update", {
      studentName: data.student?.name || name,
      studentEmail: data.student?.email || email,
    });
    window.location.href = "/student.html";
  } catch (error) {
    if (error.status === 403) {
      showBlocked(error.message);
      return;
    }
    setAuthStatus(error.message || "تعذر إنشاء الحساب.", "error");
  } finally {
    setButtonLoading(authEl.registerSubmitBtn, false);
  }
}
