(function buildPlatformClient() {
  const TOKEN_KEY = "exam-student-token";
  const DEVICE_KEY = "exam-device-id";
  const VISITOR_KEY = "exam-visitor-session-id";

  function ensureDeviceId() {
    let value = window.localStorage.getItem(DEVICE_KEY) || "";
    if (!value) {
      value = window.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage.setItem(DEVICE_KEY, value);
    }
    return value;
  }

  function getStudentToken() {
    return window.localStorage.getItem(TOKEN_KEY) || "";
  }

  function setStudentToken(token) {
    if (token) {
      window.localStorage.setItem(TOKEN_KEY, token);
    }
  }

  function clearStudentToken() {
    window.localStorage.removeItem(TOKEN_KEY);
  }

  function ensureVisitorSessionId() {
    let value = window.localStorage.getItem(VISITOR_KEY) || "";
    if (!value) {
      value = window.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      window.localStorage.setItem(VISITOR_KEY, value);
    }
    return value;
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(String(value || "").trim().toLowerCase());
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildHeaders(extraHeaders = {}) {
    const headers = new Headers(extraHeaders);
    if (!headers.has("x-device-id")) {
      headers.set("x-device-id", ensureDeviceId());
    }

    const token = getStudentToken();
    if (token && !headers.has("x-student-token")) {
      headers.set("x-student-token", token);
    }

    return headers;
  }

  async function request(url, options = {}) {
    const { json, headers: inputHeaders = {}, ...rest } = options;
    const headers = buildHeaders(inputHeaders);
    const config = {
      method: rest.method || (json ? "POST" : "GET"),
      ...rest,
      headers,
    };

    if (json !== undefined) {
      headers.set("content-type", "application/json");
      config.body = JSON.stringify(json);
    }

    const response = await fetch(url, config);
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => "");

    if (!response.ok) {
      const error = new Error(
        (payload && typeof payload === "object" && payload.error) || response.statusText || "Request failed.",
      );
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async function requestBlob(url, options = {}) {
    const { headers: inputHeaders = {}, ...rest } = options;
    const headers = buildHeaders(inputHeaders);
    const response = await fetch(url, {
      ...rest,
      headers,
    });

    if (!response.ok) {
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      const error = new Error(payload.error || response.statusText || "Download failed.");
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return response;
  }

  function buildVisitorContext(reason = "page_open", extra = {}) {
    return {
      sessionId: ensureVisitorSessionId(),
      studentName: extra.studentName || "",
      studentEmail: extra.studentEmail || "",
      language: navigator.language || "",
      languages: Array.isArray(navigator.languages) ? navigator.languages.slice(0, 6) : [],
      platform: navigator.userAgentData?.platform || navigator.platform || "",
      deviceModel: navigator.userAgentData?.model || "",
      screen: window.screen ? `${window.screen.width}x${window.screen.height}` : "",
      viewport: `${window.innerWidth || 0}x${window.innerHeight || 0}`,
      hardwareConcurrency: navigator.hardwareConcurrency || 0,
      deviceMemory: navigator.deviceMemory || 0,
      touchPoints: navigator.maxTouchPoints || 0,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      userAgent: navigator.userAgent || "",
      pageUrl: window.location.href,
      referrer: document.referrer || "",
      reason,
    };
  }

  async function registerVisitor(reason = "page_open", extra = {}) {
    try {
      return await request("/api/visitors/session", {
        method: "POST",
        json: buildVisitorContext(reason, extra),
      });
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  function triggerBrowserDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName || "file";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 800);
  }

  window.PlatformClient = {
    escapeHtml,
    ensureDeviceId,
    ensureVisitorSessionId,
    getStudentToken,
    setStudentToken,
    clearStudentToken,
    isValidEmail,
    request,
    requestBlob,
    registerVisitor,
    triggerBrowserDownload,
  };
})();
