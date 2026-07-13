import {
  createStore,
  mount,
  setDevMode,
} from "https://cdn.jsdelivr.net/npm/lime-csr-js@0.1.4/dist/index.min.js";

// Configuration (avatar seeds + cover gradients ported from the original UI)
const CONFIG = {
  defaultBio: "Hello, I am new to CentrumChat workspace!",
  avatarSeeds: ["Felix", "Max", "Luna", "Cleo", "Oliver", "Milo", "Leo", "Lucy"],
  coverGradients: [
    "linear-gradient(135deg, #0284c7, #8e44ad)",
    "linear-gradient(135deg, #1abc9c, #2ecc71)",
    "linear-gradient(135deg, #e74c3c, #f1c40f)",
    "linear-gradient(135deg, #34495e, #2c3e50)",
    "linear-gradient(135deg, #d35400, #c0392b)",
    "linear-gradient(135deg, #00c6ff, #0072ff)",
  ],
};

function createStorageArea(browserStorage, label) {
  return {
    isAvailable: (() => {
      try {
        const testKey = `__storage_test__${label}`;
        browserStorage.setItem(testKey, testKey);
        browserStorage.removeItem(testKey);
        return true;
      } catch {
        return false;
      }
    })(),
    memoryStore: {},
    getItem(key) {
      if (this.isAvailable) {
        try {
          return browserStorage.getItem(key);
        } catch (e) {
          console.warn(`${label} storage read failed:`, e);
        }
      }
      return this.memoryStore[key] || null;
    },
    setItem(key, value) {
      if (this.isAvailable) {
        try {
          browserStorage.setItem(key, value);
          return;
        } catch (e) {
          console.warn(`${label} storage write failed:`, e);
        }
      }
      this.memoryStore[key] = value;
    },
    removeItem(key) {
      if (this.isAvailable) {
        try {
          browserStorage.removeItem(key);
          return;
        } catch (e) {
          console.warn(`${label} storage delete failed:`, e);
        }
      }
      delete this.memoryStore[key];
    },
  };
}

const STORAGE = createStorageArea(window.localStorage, "local");
const SESSION_STORAGE = createStorageArea(window.sessionStorage, "session");
const TOKEN_KEYS = {
  persistent: "chat_session_tokens_persistent",
  session: "chat_session_tokens_session",
};

function parseStoredTokens(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed.accessToken === "string" && typeof parsed.refreshToken === "string"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

const TOKENS = {
  get: () => {
    const persistent = parseStoredTokens(STORAGE.getItem(TOKEN_KEYS.persistent));
    const session = parseStoredTokens(SESSION_STORAGE.getItem(TOKEN_KEYS.session));
    if (persistent && session) {
      SESSION_STORAGE.removeItem(TOKEN_KEYS.session);
      return persistent;
    }
    return persistent || session;
  },
  isRemembered: () => parseStoredTokens(STORAGE.getItem(TOKEN_KEYS.persistent)) !== null,
  set: (tokens, rememberMe = TOKENS.isRemembered()) => {
    STORAGE.removeItem(TOKEN_KEYS.persistent);
    SESSION_STORAGE.removeItem(TOKEN_KEYS.session);
    const serialized = JSON.stringify(tokens);
    if (rememberMe) {
      STORAGE.setItem(TOKEN_KEYS.persistent, serialized);
    } else {
      SESSION_STORAGE.setItem(TOKEN_KEYS.session, serialized);
    }
  },
  clear: () => {
    STORAGE.removeItem(TOKEN_KEYS.persistent);
    SESSION_STORAGE.removeItem(TOKEN_KEYS.session);
  },
};

function makeClientError(code, message) {
  const error = new Error(message || "An error occurred.");
  error.code = code || "INTERNAL_ERROR";
  return error;
}

function currentDeviceLabel() {
  return "Web browser";
}

function handleSecurityErrorCode(code) {
  if (code === "EMAIL_VERIFICATION_REQUIRED" && store.get("session.loggedIn")) {
    refreshAccountSecurityState().catch(() => {});
  }
  if (
    ["MESSAGE_MUTED", "INTERACTION_RESTRICTED", "ACCOUNT_SUSPENDED", "BLOCKED_INTERACTION"]
      .includes(code)
  ) {
    ToastService.show("This action is unavailable because of an account safety policy.", "warning");
  }
}

const CAPTCHA = {
  tokens: { register: null, login: null, password_reset: null },
  widgetIds: [],
  config: null,
  async initialize() {
    try {
      const response = await fetch("/api/config/public");
      const body = response.ok ? await response.json() : null;
      this.config = body?.data?.captcha ?? null;
      if (this.config?.provider !== "turnstile" || !this.config.siteKey) return;
      const renderAll = () => {
        if (!window.turnstile) return;
        for (const [action, elementId] of [
          ["register", "captchaRegister"],
          ["login", "captchaLogin"],
          ["password_reset", "captchaPasswordReset"],
        ]) {
          const element = document.getElementById(elementId);
          if (!element || element.hasChildNodes()) continue;
          const widgetId = window.turnstile.render(element, {
            sitekey: this.config.siteKey,
            action,
            callback: (token) => this.tokens[action] = token,
            "expired-callback": () => this.tokens[action] = null,
            "error-callback": () => this.tokens[action] = null,
          });
          this.widgetIds.push(widgetId);
        }
      };
      window.turnstile ? renderAll() : setTimeout(renderAll, 500);
    } catch (error) {
      console.warn("CAPTCHA configuration unavailable:", error);
    }
  },
  consume(action) {
    const token = this.tokens[action];
    this.tokens[action] = null;
    if (window.turnstile) {
      for (const widgetId of this.widgetIds) window.turnstile.reset(widgetId);
    }
    return token;
  },
};

async function submitSafetyReport(targetType, targetId) {
  const reasonCode = window.prompt(
    "Reason: spam, harassment, threats, impersonation, sexual_content, illegal_content, privacy, or other",
    "other",
  );
  if (!reasonCode) return;
  const details = window.prompt("Optional details (maximum 2,000 characters):", "") || undefined;
  try {
    await apiFetch("/api/safety/reports", {
      method: "POST",
      body: JSON.stringify({ targetType, targetId, reasonCode, details }),
    });
    ToastService.show("Report submitted for review.", "success");
  } catch (error) {
    console.error("Report submission failed:", error);
  }
}

const HELPERS = {
  sanitize: (str) => {
    const temp = document.createElement("div");
    temp.textContent = str;
    return temp.innerHTML;
  },
  dicebearUrl: (seed) =>
    `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(seed || "centrum")}`,
  formatJoined: (isoStr) => {
    const d = new Date(isoStr);
    if (isNaN(d)) return "";
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  },
  formatBytes: (bytes) => {
    if (!bytes) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  },
  getRelativeLuminance: (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b].map((v) => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  },
  getContrastRatio: (hex1, hex2) => {
    const rgb1 = HELPERS.getRelativeLuminance(hex1);
    const rgb2 = HELPERS.getRelativeLuminance(hex2);
    const l1 = 0.2126 * rgb1[0] + 0.7152 * rgb1[1] + 0.0722 * rgb1[2];
    const l2 = 0.2126 * rgb2[0] + 0.7152 * rgb2[1] + 0.0722 * rgb2[2];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  },
};

function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64).split("").map(function (c) {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(""),
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

// Exchange the stored refresh token for a fresh token pair. Returns false when
// the server rejects the refresh (revoked/expired session); throws on network
// failure so callers can distinguish "logged out" from "temporarily offline".
async function tryRefreshTokens() {
  const tokens = TOKENS.get();
  if (!tokens?.refreshToken) return false;
  const rememberedMode = TOKENS.isRemembered();
  const response = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });
  const data = response.ok ? await response.json() : null;
  if (!data?.success) return false;
  TOKENS.set(
    { accessToken: data.data.accessToken, refreshToken: data.data.refreshToken },
    rememberedMode,
  );
  return true;
}

// Return a usable access token, proactively refreshing when it is expired or
// about to expire. Chat traffic is WS-only, so apiFetch's 401-refresh path may
// never run during a long session — without this, every reconnect handshake
// would present the same expired token forever. Returns null only when the
// server rejected the refresh (the session is really over); network failures
// fall back to the stored token so the caller's retry loop can try again.
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

async function ensureFreshAccessToken() {
  const tokens = TOKENS.get();
  if (!tokens?.accessToken) return null;
  const expMs = (parseJwt(tokens.accessToken)?.exp || 0) * 1000;
  if (expMs - Date.now() > TOKEN_EXPIRY_MARGIN_MS) return tokens.accessToken;
  try {
    if (await tryRefreshTokens()) {
      return TOKENS.get()?.accessToken ?? null;
    }
    return null;
  } catch {
    return tokens.accessToken;
  }
}

// HTTP Client (Bearer header + one-shot refresh retry on 401)
async function apiFetch(url, options = {}) {
  const tokens = TOKENS.get();
  options.headers = options.headers || {};
  if (tokens?.accessToken) {
    options.headers["Authorization"] = `Bearer ${tokens.accessToken}`;
  }

  if (options.body && !(options.body instanceof FormData) && !options.headers["Content-Type"]) {
    options.headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    ToastService.show("Network error: " + err.message, "error");
    throw err;
  }

  if (response.status === 401 && tokens?.refreshToken) {
    let refreshed = false;
    try {
      refreshed = await tryRefreshTokens();
    } catch (refreshErr) {
      clearAuthenticatedState("Session expired. Please log in again.", "warning");
      throw refreshErr;
    }
    if (!refreshed) {
      clearAuthenticatedState("Session expired. Please log in again.", "warning");
      throw makeClientError("UNAUTHORIZED", "Session expired. Please log in again.");
    }
    options.headers["Authorization"] = `Bearer ${TOKENS.get().accessToken}`;
    response = await fetch(url, options);
  }

  let responseJson;
  try {
    responseJson = await response.json();
  } catch {
    const errMsg = `Request failed (${response.status}).`;
    ToastService.show(errMsg, "error");
    throw new Error(errMsg);
  }
  if (!responseJson.success) {
    const errMsg = responseJson.error?.message || "An error occurred.";
    handleSecurityErrorCode(responseJson.error?.code);
    ToastService.show(errMsg, "error");
    throw makeClientError(responseJson.error?.code, errMsg);
  }

  return responseJson.data;
}

// WebSocket Client: request/response RPC keyed by envelope id + push dispatcher
class WebSocketClient {
  constructor() {
    this.socket = null;
    this.pendingRequests = new Map();
    this.listeners = new Map();
    this.requestIdCounter = 0;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.readyPromise = null;
    this.hadConnection = false;
    this.onReconnect = null;
  }

  async connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    ) {
      return this.socket.readyState === WebSocket.OPEN ? Promise.resolve() : this.readyPromise;
    }

    if (this.isConnecting && this.readyPromise) return this.readyPromise;

    this.isConnecting = true;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const readyPromise = this.readyPromise;
    // Timer-driven retries don't await connect(); avoid unhandled rejections.
    readyPromise.catch(() => {});

    const accessToken = await ensureFreshAccessToken();

    // disconnect() may have run while the refresh was in flight.
    if (this.readyPromise !== readyPromise) return readyPromise;

    if (!accessToken) {
      this.failConnect(new Error("Authentication is required for WebSocket requests."));
      // A stored token that can no longer be refreshed means the session was
      // revoked/expired server-side — stop retrying and go back to sign-in.
      if (TOKENS.get()) {
        clearAuthenticatedState("Session expired. Please log in again.", "warning");
      }
      return readyPromise;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${
      encodeURIComponent(accessToken)
    }`;

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      const isReconnect = this.hadConnection;
      this.hadConnection = true;
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      if (isReconnect && this.onReconnect) this.onReconnect();
    };

    this.socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        if (envelope.id) {
          const pending = this.pendingRequests.get(envelope.id);
          if (pending) {
            this.pendingRequests.delete(envelope.id);
            if (envelope.success) {
              pending.resolve(envelope.data);
            } else {
              const errMsg = envelope.error?.message || "Request failed.";
              handleSecurityErrorCode(envelope.error?.code);
              ToastService.show(errMsg, "error");
              pending.reject(makeClientError(envelope.error?.code, errMsg));
            }
          }
        } else {
          this.dispatchEvent(envelope.event, envelope.data);
        }
      } catch (err) {
        console.error("Error processing WebSocket message:", err);
      }
    };

    this.socket.onclose = () => {
      this.isConnecting = false;
      this.rejectReady?.(new Error("WebSocket connection closed."));
      this.resolveReady = null;
      this.rejectReady = null;
      this.rejectAllPendingRequests(new Error("WebSocket connection closed."));
      this.scheduleReconnect();
    };

    this.socket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    return readyPromise;
  }

  failConnect(error) {
    this.isConnecting = false;
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;
  }

  // Exponential backoff with jitter: ~1s after the first drop, doubling to a
  // 30s ceiling. A successful open — or reconnectNow() — resets the counter.
  scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (!TOKENS.get()?.accessToken) return;
    const backoffMs = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    const delayMs = backoffMs * (0.5 + Math.random() * 0.5);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delayMs);
  }

  // Skip any pending backoff delay and retry right away (network back online,
  // tab foregrounded again).
  reconnectNow() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (!TOKENS.get()?.accessToken) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.connect().catch(() => {});
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.hadConnection = false;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.onclose = null;
      socket.close();
    }
    this.rejectReady?.(new Error("Disconnected."));
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;
    this.rejectAllPendingRequests(new Error("Disconnected."));
  }

  rejectAllPendingRequests(error) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  sendFireAndForget(event, data = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify({ id: `sys-${++this.requestIdCounter}`, event, data }));
    return true;
  }

  async request(event, data = {}) {
    await this.connect();
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket is not connected."));
        return;
      }
      const requestId = `c-${++this.requestIdCounter}`;
      const payload = { id: requestId, event, data };

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request ${event} timed out.`));
        }
      }, 15000);

      this.pendingRequests.set(requestId, {
        resolve: (res) => {
          clearTimeout(timeout);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.socket.send(JSON.stringify(payload));
    });
  }

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  dispatchEvent(event, data) {
    const list = this.listeners.get(event);
    if (list) {
      for (const cb of list) {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      }
    }
  }
}

const wsClient = new WebSocketClient();

// Transport heartbeat: answer internally, without UI effects or pending-request bookkeeping.
wsClient.addEventListener("system.ping", () => {
  wsClient.sendFireAndForget("system.pong", {});
});

// Reconnect immediately when connectivity returns or the tab is foregrounded,
// instead of sitting out the remaining backoff delay.
window.addEventListener("online", () => {
  if (store.get("session.loggedIn")) wsClient.reconnectNow();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && store.get("session.loggedIn")) wsClient.reconnectNow();
});

// Wire-shape -> view-model mappers. `users` store map is keyed by USER ID everywhere.
const MAPPERS = {
  userSummary: (u) => {
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      displayName: u.displayName || u.username,
      avatarSeed: u.avatarSeed || "",
      avatarUrl: u.avatarUrl || HELPERS.dicebearUrl(u.avatarSeed || u.username),
      nameColor: u.nameColor || "#0284c7",
      status: u.status || "offline",
    };
  },

  profile: (p) => {
    if (!p) return null;
    return {
      ...MAPPERS.userSummary(p),
      bio: p.bio || CONFIG.defaultBio,
      joinedDate: HELPERS.formatJoined(p.joinedDate),
      isPremium: !!p.isPremium,
      messagesSent: p.messagesSent || 0,
      reactionsAdded: p.reactionsAdded || 0,
      repliesMade: p.repliesMade || 0,
      coverIndex: p.coverIndex || 0,
      coverUrl: p.coverUrl || null,
      isOperator: !!p.isOperator,
    };
  },

  conversation: (r) => {
    if (!r) return null;
    return {
      id: r.id,
      type: r.type,
      slug: r.slug || "",
      name: r.name || "",
      topic: r.topic || "",
      ownerId: r.ownerId || "",
      memberCount: r.memberCount || 0,
      createdAt: r.createdAt || "",
    };
  },

  message: (m) => {
    if (!m) return null;
    const reactions = {};
    if (m.reactions) {
      for (const r of m.reactions) {
        reactions[r.emoji] = r.userIds || [];
      }
    }

    return {
      id: m.id,
      conversationId: m.conversationId,
      authorId: m.authorId || null,
      content: m.content,
      timestamp: m.createdAt
        ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "",
      isoTimestamp: m.createdAt || "",
      reactions,
      replyTo: m.replyToId || null,
      attachment: m.attachments && m.attachments.length > 0
        ? {
          name: m.attachments[0].fileName,
          size: m.attachments[0].sizeBytes,
          type: m.attachments[0].mimeType,
          url: m.attachments[0].url,
        }
        : null,
      system: !!m.isSystem,
      edited: !!m.edited,
      deletedAt: m.deletedAt || null,
    };
  },

  preferences: (p) => {
    if (!p) {
      return {
        sound: true,
        desktopNotif: false,
        dmPrivacy: "everyone",
        groupPrivacy: "everyone",
        theme: "light",
      };
    }
    return {
      sound: p.sound !== false,
      desktopNotif: !!p.desktopNotifications,
      dmPrivacy: p.dmPrivacy || "everyone",
      groupPrivacy: p.groupPrivacy || "everyone",
      theme: p.theme || "light",
    };
  },
};

const ToastService = {
  show: (message, type = "info") => {
    const toastId = "toast_" + Math.random().toString(36).slice(2, 7);
    const iconMap = {
      success: "bi-check-circle-fill text-success",
      error: "bi-exclamation-triangle-fill text-danger",
      warning: "bi-exclamation-circle-fill text-warning",
      info: "bi-info-circle-fill text-primary",
    };

    const toastHtml = `
      <div id="${toastId}" class="toast toast-custom hide" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="toast-header border-0 bg-transparent">
          <i class="bi ${iconMap[type]} me-2"></i>
          <strong class="me-auto text-capitalize">${type}</strong>
          <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
        <div class="toast-body py-1 pb-3 px-3"></div>
      </div>
    `;

    const container = document.getElementById("toastContainer");
    if (container) {
      container.insertAdjacentHTML("beforeend", toastHtml);
      const toastEl = document.getElementById(toastId);
      toastEl.querySelector(".toast-body").textContent = String(message);
      const bsToast = window.bootstrap?.Toast
        ? new window.bootstrap.Toast(toastEl, { delay: 4000 })
        : null;
      if (!bsToast) {
        toastEl.classList.add("show");
        setTimeout(() => toastEl.remove(), 4000);
        return;
      }
      bsToast.show();

      toastEl.addEventListener("hidden.bs.toast", () => {
        toastEl.remove();
      });
    }
  },
};

// State Store
const store = createStore({
  session: {
    loggedIn: false,
    user: null,
    isEditingProfile: false,
    profileDraft: {
      displayName: "",
      bio: "",
    },
    messageToDeleteId: null,
  },
  accountSecurity: {
    email: "",
    emailVerifiedAt: null,
    pendingEmail: null,
    isVerified: false,
  },
  sessionList: [],
  authState: {
    activeTab: "signin",
    signinEmail: "",
    signinPassword: "",
    signinRememberMe: false,
    signupUsername: "",
    signupEmail: "",
    signupPassword: "",
    signupRememberMe: false,
    resetMode: false,
    resetToken: "",
    resetEmail: "",
    resetNewPassword: "",
    resetConfirmPassword: "",
    pendingEmailChangeToken: "",
    signinClass: "active",
    signupClass: "",
  },
  searchState: {
    activeTab: "channels",
    userQuery: "",
    groupQuery: "",
    messageQuery: "",
    searchOpen: false,
    searchResults: [],
    searchResultsMessages: null,
  },
  activeDest: { type: "channel", value: "general" },
  activeDestKey: "channel_general",
  notifications: {},
  // Keyed by user id (message authors, DM partners, self).
  users: {},
  groupList: [],
  channelList: [],
  resolvedDms: [],
  messages: {},
  prefs: {
    sound: true,
    desktopNotif: false,
    dmPrivacy: "everyone",
    groupPrivacy: "everyone",
    theme: STORAGE.getItem("chat_dark_mode") === "1" ? "dark" : "light",
  },

  chatForm: {
    messageInput: "",
    attachedFileId: null,
    attachedFileDetails: null,
  },
  replyTarget: null,

  typingState: {
    active: false,
    avatarUrl: "",
    text: "",
  },
  lightbox: {
    open: false,
    imgSrc: "",
  },
  preferencesForm: {
    activeTab: "appearance",
    theme: "light",
    nameColor: "#0284c7",
    isPremium: false,
    sound: true,
    desktopNotif: false,
    dmPrivacy: "everyone",
    groupPrivacy: "everyone",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    newEmail: "",
  },
  visitorProfile: {
    id: "",
    username: "",
    displayName: "",
    bio: "",
    avatarUrl: "",
    statusColor: "",
    statusGlow: "",
    statusBadgeClass: "",
    statusText: "",
    joinedDate: "",
    messagesSent: 0,
    reactionsAdded: 0,
    repliesMade: 0,
    isPremium: false,
    mutualGroups: [],
    mutualGroupsCount: 0,
    coverStyle: "",
    nameColor: "",
    isSelf: false,
    handleDisplay: "",
  },
  createGroupForm: {
    name: "",
    candidateUsers: [],
    selectedUserIds: [],
  },
  groupMembersForm: {
    members: [],
    canAddMembers: false,
    addableUsers: [],
  },
  profileImagesForm: {
    avatarFile: null,
    coverFile: null,
  },
});

setDevMode(true);

function applyTheme(theme) {
  if (theme === "dark") {
    document.body.classList.add("dark-mode");
    STORAGE.setItem("chat_dark_mode", "1");
  } else {
    document.body.classList.remove("dark-mode");
    STORAGE.setItem("chat_dark_mode", "0");
  }
}

function coverStyleFor(coverUrl, coverIndex) {
  if (coverUrl) return `url('${coverUrl}') center/cover no-repeat`;
  const gradients = CONFIG.coverGradients;
  return gradients[(coverIndex || 0) % gradients.length];
}

// Resolve the active destination's real room id (channels are addressed by slug in the UI).
function activeConversationId() {
  const dest = store.get("activeDest");
  if (!dest) return null;
  if (dest.type === "channel") {
    const chan = (store.get("channelList") || []).find((c) => c.slug === dest.value);
    return chan ? chan.id : null;
  }
  return dest.value;
}

// Debounced typing tracking (fire-and-forget requests; the server acks each envelope)
let typingTimeout = null;
let isTypingSent = false;

function sendTypingStart(conversationId) {
  if (!conversationId) return;
  if (isTypingSent) {
    clearTimeout(typingTimeout);
  } else {
    wsClient.request("typing.start", { conversationId }).catch(() => {});
    isTypingSent = true;
  }
  typingTimeout = setTimeout(() => {
    sendTypingStop(conversationId);
  }, 4000);
}

function sendTypingStop(conversationId) {
  if (isTypingSent) {
    clearTimeout(typingTimeout);
    if (conversationId) wsClient.request("typing.stop", { conversationId }).catch(() => {});
    isTypingSent = false;
  }
}

// ── Computed Properties ───────────────────────────────────────────
// NOTE: computed callbacks receive NO arguments — always read via store.get.

// Factory for the many one-liner computeds that just compare a store value
// ("is this tab active?") and yield a class string or boolean.
function computedMatch(target, dep, value, whenTrue, whenFalse = "") {
  store.computed(target, [dep], () => store.get(dep) === value ? whenTrue : whenFalse);
}

// Factory for background-image styles derived from an avatar url.
function computedAvatarStyle(target, dep) {
  store.computed(target, [dep], () => {
    const url = store.get(dep);
    return url ? `url('${url}') center/cover no-repeat` : "";
  });
}

store.computed("activeDestLabel", ["activeDest", "groupList", "resolvedDms"], () => {
  const dest = store.get("activeDest");
  if (!dest) return "";
  if (dest.type === "channel") return `# ${dest.value}`;
  if (dest.type === "dm") {
    const resolvedDms = store.get("resolvedDms") || [];
    const activeDm = resolvedDms.find((d) => d.conversationId === dest.value);
    return activeDm ? `@ ${activeDm.displayName}` : "Direct Message";
  }
  if (dest.type === "group") {
    const groups = store.get("groupList") || [];
    const g = groups.find((x) => x.id === dest.value);
    return g ? `~ ${g.name}` : "Group";
  }
  return "";
});

store.computed("channels", ["activeDest", "notifications", "channelList"], () => {
  const activeDest = store.get("activeDest");
  const chans = store.get("channelList") || [];
  return chans.map((c) => ({
    slug: c.slug,
    activeClass: (activeDest.type === "channel" && activeDest.value === c.slug) ? "active" : "",
    notifCount: store.get(`notifications.channel_${c.slug}`) || 0,
  }));
});

store.computed(
  "dms",
  [
    "resolvedDms",
    "activeDest",
    "notifications",
    "searchState.userQuery",
    "searchState.searchResults",
    "session.user",
  ],
  () => {
    const activeDest = store.get("activeDest");
    const resolvedDms = store.get("resolvedDms") || [];
    const query = (store.get("searchState.userQuery") || "").trim();
    const currentUser = store.get("session.user");

    const list = query ? (store.get("searchState.searchResults") || []) : resolvedDms;
    const dmByUserId = new Map(resolvedDms.map((d) => [d.id, d]));

    return list
      .filter((u) => !currentUser || u.id !== currentUser.id)
      .map((u) => {
        const conversationId = u.conversationId || dmByUserId.get(u.id)?.conversationId || null;
        return {
          ...u,
          conversationId,
          activeClass: (activeDest.type === "dm" && conversationId && activeDest.value === conversationId)
            ? "active"
            : "",
          notifCount: conversationId ? (store.get(`notifications.dm_${conversationId}`) || 0) : 0,
        };
      });
  },
);

store.computed(
  "groups",
  ["groupList", "activeDest", "notifications", "searchState.groupQuery"],
  () => {
    const activeDest = store.get("activeDest");
    const allGroups = store.get("groupList") || [];
    const query = (store.get("searchState.groupQuery") || "").trim().toLowerCase();

    return allGroups
      .filter((g) => !query || g.name.toLowerCase().includes(query))
      .map((g) => ({
        ...g,
        activeClass: (activeDest.type === "group" && activeDest.value === g.id) ? "active" : "",
        notifCount: store.get(`notifications.group_${g.id}`) || 0,
      }));
  },
);

store.computed("session.user.statusClass", ["session.user.status"], () => {
  return store.get("session.user.status") || "offline";
});

store.computed("session.user.usernameDisplay", ["session.user.username"], () => {
  const username = store.get("session.user.username");
  return username ? `@${username}` : "";
});

store.computed("session.user.handleDisplay", ["session.user.username"], () => {
  const username = store.get("session.user.username");
  return username ? `@${username}` : "";
});

store.computed(
  "session.user.coverStyle",
  ["session.user.coverUrl", "session.user.coverIndex"],
  () => {
    return coverStyleFor(
      store.get("session.user.coverUrl"),
      store.get("session.user.coverIndex"),
    );
  },
);

computedAvatarStyle("session.user.avatarStyle", "session.user.avatarUrl");
computedAvatarStyle("typingState.avatarStyle", "typingState.avatarUrl");
computedAvatarStyle("visitorProfile.avatarStyle", "visitorProfile.avatarUrl");

function totalNotificationCount() {
  const notifs = store.get("notifications");
  return notifs ? Object.values(notifs).reduce((sum, n) => sum + (n || 0), 0) : 0;
}

store.computed("headerNotifBadge.text", ["notifications"], () => {
  const total = totalNotificationCount();
  return total > 99 ? "99+" : String(total);
});

store.computed("headerNotifBadge.class", ["notifications"], () => {
  return totalNotificationCount() > 0 ? "" : "d-none";
});

store.computed("activeGroupBadge.visible", ["activeDest"], () => {
  const dest = store.get("activeDest");
  return !!(dest && dest.type === "group");
});

store.computed("activeGroupBadge.memberCount", ["activeDest", "groupList"], () => {
  const dest = store.get("activeDest");
  if (!dest || dest.type !== "group") return 0;
  const groups = store.get("groupList") || [];
  const g = groups.find((x) => x.id === dest.value);
  return g ? g.memberCount : 0;
});

store.computed("typingState.class", ["typingState.active"], () => {
  return store.get("typingState.active") ? "show" : "";
});

store.computed("replyContextState.class", ["replyTarget"], () => {
  return store.get("replyTarget") ? "show" : "";
});

store.computed("replyContextState.title", ["replyTarget"], () => {
  const target = store.get("replyTarget");
  if (!target) return "";
  return target.isEdit ? "Editing message" : `Replying to ${target.displayName}`;
});

store.computed("replyContextState.text", ["replyTarget"], () => {
  const target = store.get("replyTarget");
  return target ? `"${target.content}"` : "";
});

store.computed("lightbox.class", ["lightbox.open"], () => {
  return store.get("lightbox.open") ? "show" : "";
});

store.computed("attachedFilePreview", ["chatForm.attachedFileDetails"], () => {
  const details = store.get("chatForm.attachedFileDetails");
  return details ? [details] : [];
});

computedMatch("preferencesForm.appearanceTabClass", "preferencesForm.activeTab", "appearance", "active");
computedMatch("preferencesForm.privacyTabClass", "preferencesForm.activeTab", "privacy", "active");
computedMatch("preferencesForm.securityTabClass", "preferencesForm.activeTab", "security", "active");

computedMatch("preferencesForm.lightThemeClass", "preferencesForm.theme", "light", "active-theme");
computedMatch("preferencesForm.darkThemeClass", "preferencesForm.theme", "dark", "active-theme");

computedMatch("themeIcon", "prefs.theme", "dark", "bi-sun", "bi-moon-stars");

computedMatch("searchState.channelsClass", "searchState.activeTab", "channels", "active");
computedMatch("searchState.groupsClass", "searchState.activeTab", "groups", "active");
computedMatch("searchState.usersClass", "searchState.activeTab", "users", "active");

store.computed(
  "searchState.barClass",
  ["searchState.searchOpen"],
  () => store.get("searchState.searchOpen") ? "show" : "",
);

// data-show booleans for the destination dropdown tab panels
computedMatch("searchState.showChannels", "searchState.activeTab", "channels", true, false);
computedMatch("searchState.showGroups", "searchState.activeTab", "groups", true, false);
computedMatch("searchState.showUsers", "searchState.activeTab", "users", true, false);

store.computed(
  "visitorProfile.hasMutualGroups",
  ["visitorProfile.mutualGroups"],
  () => (store.get("visitorProfile.mutualGroups") || []).length > 0,
);

// Message row view-model builder. All fields are rendered statically inside the
// live <for data-diff="replace"> loop, so every field must be precomputed here.
// `context` carries per-render lookups shared across the whole message list.
function decorateMessage(msg, { currentUser, usersMap, messagesById, activeGroup }) {
  const author = (msg.authorId && usersMap[msg.authorId]) || {};
  const isOutgoing = !!(currentUser && msg.authorId === currentUser.id);

  let sizeFormatted = "";
  let fileIconClass = "bi-file-earmark";
  const attachment = msg.attachment ? { ...msg.attachment } : null;
  if (attachment) {
    // Attachments are auth-gated; <img>/<a> tags can't send headers, so the
    // access token rides along as a query param (docs/04 "GET /media/:id").
    const tokens = TOKENS.get();
    if (tokens?.accessToken && attachment.url && attachment.url.startsWith("/media/")) {
      attachment.url = `${attachment.url}?token=${encodeURIComponent(tokens.accessToken)}`;
    }
    sizeFormatted = HELPERS.formatBytes(attachment.size);
    const type = attachment.type || "";
    if (type.startsWith("image/")) {
      attachment.isImage = true;
    } else {
      attachment.isImage = false;
      if (type.includes("pdf")) fileIconClass = "bi-file-earmark-pdf text-danger";
      else if (type.includes("word") || type.includes("doc")) {
        fileIconClass = "bi-file-earmark-word text-primary";
      } else if (type.includes("sheet") || type.includes("excel") || type.includes("csv")) {
        fileIconClass = "bi-file-earmark-excel text-success";
      } else if (type.includes("zip") || type.includes("rar") || type.includes("archive")) {
        fileIconClass = "bi-file-earmark-zip text-warning";
      } else if (type.includes("audio")) fileIconClass = "bi-file-earmark-music text-info";
      else if (type.includes("video")) fileIconClass = "bi-file-earmark-play text-danger";
      else if (type.includes("text")) fileIconClass = "bi-file-earmark-text text-muted";
    }
  }

  const reactionBadges = Object.entries(msg.reactions || {}).map(([emoji, userIds]) => ({
    emoji,
    count: userIds.length,
    activeClass: (currentUser && userIds.includes(currentUser.id)) ? "user-reacted" : "",
  }));

  const parentMsg = msg.replyTo ? messagesById.get(msg.replyTo) : null;
  const parentAuthor = parentMsg && parentMsg.authorId ? usersMap[parentMsg.authorId] : null;

  return {
    ...msg,
    isNormal: true,
    isOutgoing,
    groupClass: isOutgoing ? "outgoing" : "incoming",
    displayName: author.displayName || "Unknown",
    userColor: author.nameColor || "var(--text-dark)",
    isPremium: !!author.isPremium,
    isGroupOwner: !!(activeGroup && activeGroup.ownerId === msg.authorId),

    hasAttachment: !!attachment,
    attachment: attachment ? { ...attachment, fileIconClass, sizeFormatted } : null,
    attachmentUrl: attachment ? attachment.url : "",
    attachmentName: attachment ? attachment.name : "",
    attachmentSizeFormatted: attachment ? sizeFormatted : "",
    attachmentIsImage: attachment ? attachment.isImage : false,
    attachmentFileIconClass: attachment ? fileIconClass : "",

    replyToUser: parentMsg ? (parentAuthor?.displayName || "Unknown") : "",
    replyToText: parentMsg ? parentMsg.content : "",

    hasReactions: reactionBadges.length > 0,
    reactionBadges,
  };
}

store.computed("activeMessages", [
  "activeDestKey",
  "messages",
  "searchState.messageQuery",
  "searchState.searchResultsMessages",
  "users",
  "groupList",
  "session.user",
], () => {
  const destKey = store.get("activeDestKey");
  const query = (store.get("searchState.messageQuery") || "").trim();
  let msgs = store.get(`messages.${destKey}`) || [];

  if (query) {
    msgs = store.get("searchState.searchResultsMessages") || [];
  }

  msgs = msgs.filter((m) => !m.deletedAt);

  const decorated = [];
  let lastDateLabel = "";

  // Today/yesterday boundaries and per-render lookup tables are computed once,
  // not per message.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const formatDateSep = (isoStr) => {
    const d = new Date(isoStr);
    if (isNaN(d)) return null;
    const msgDayMs = new Date(d).setHours(0, 0, 0, 0);
    if (msgDayMs === today.getTime()) return "Today";
    if (msgDayMs === yesterday.getTime()) return "Yesterday";
    return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  const activeDest = store.get("activeDest");
  const decorateContext = {
    currentUser: store.get("session.user"),
    usersMap: store.get("users") || {},
    messagesById: new Map(msgs.map((m) => [m.id, m])),
    activeGroup: activeDest.type === "group"
      ? (store.get("groupList") || []).find((g) => g.id === activeDest.value)
      : null,
  };

  for (const msg of msgs) {
    const dateLabel = msg.isoTimestamp ? formatDateSep(msg.isoTimestamp) : null;
    if (dateLabel && dateLabel !== lastDateLabel && !query) {
      lastDateLabel = dateLabel;
      // reactionBadges must always be an array: static <for> expansion runs
      // before <if> filtering in the render pipeline.
      decorated.push({
        id: `sep_${msg.id}`,
        dateSeparator: true,
        content: dateLabel,
        reactionBadges: [],
      });
    }

    if (msg.system) {
      decorated.push({
        id: msg.id,
        system: true,
        content: msg.content,
        reactionBadges: [],
      });
    } else {
      decorated.push(decorateMessage(msg, decorateContext));
    }
  }

  return decorated;
});

// Auto scroll message stream on message changes
store.subscribe("activeMessages", (newMsgs, oldMsgs) => {
  setTimeout(() => {
    const stream = document.getElementById("messageStream");
    if (!stream || !newMsgs) return;

    const lastMsg = newMsgs[newMsgs.length - 1];
    const isOwn = lastMsg && lastMsg.isOutgoing;
    const wasAtBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;

    if (wasAtBottom || isOwn || (oldMsgs && oldMsgs.length === 0)) {
      stream.scrollTop = stream.scrollHeight;
    }
  }, 50);
});

// Manual lightbox image source sync (the <img> src is set imperatively so any
// /media/... url works without going through attribute-binding URL rules)
store.subscribe("lightbox.imgSrc", (url) => {
  const img = document.getElementById("lightboxImg");
  if (img) img.setAttribute("src", url || "");
});

// Sync status changes from the profile dropdown's data-model to the server
store.subscribe("session.user.status", async (newStatus) => {
  const currentUser = store.get("session.user");
  if (!currentUser || !newStatus) return;
  if (currentUser.lastSyncedStatus === newStatus) return;
  try {
    await wsClient.request("presence.update", { status: newStatus });
    store.set("session.user", {
      ...currentUser,
      status: newStatus,
      lastSyncedStatus: newStatus,
    });
    store.set(`users.${currentUser.id}`, { ...store.get(`users.${currentUser.id}`), status: newStatus });
    ToastService.show(`Status updated to: ${newStatus.toUpperCase()}`, "success");
  } catch (err) {
    console.error("Presence status update failed:", err);
  }
});

// Keep the users map's own entry in sync with the session profile
store.subscribe("session.user", (user) => {
  if (user && user.id) {
    store.set(`users.${user.id}`, { ...user });
  }
});

// Browsers cap the number of live AudioContexts, so one shared context serves
// every beep (it is only resumed, never closed).
let beepContext = null;

function playBeep() {
  try {
    const prefs = store.get("prefs");
    if (!prefs?.sound) return;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;

    beepContext ??= new AudioContextCtor();
    const ctx = beepContext;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) {
    console.error("Audio beep synthesis failed:", e);
  }
}

// Bootstrap swallows Modal.hide() while the show-transition is still running
// (_isTransitioning guard), so hiding immediately after opening silently fails.
// These helpers retry once after the fade settles.
function showModal(id) {
  const el = document.getElementById(id);
  if (el) bootstrap.Modal.getOrCreateInstance(el).show();
}

function hideModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const instance = bootstrap.Modal.getOrCreateInstance(el);
  instance.hide();
  setTimeout(() => {
    if (el.classList.contains("show")) instance.hide();
  }, 400);
}

// Upload modal overlay (progress + success states), shared by the file-picker
// and fetch-from-URL upload paths.
const UploadOverlay = {
  els() {
    return {
      container: document.getElementById("uploadStatusContainer"),
      progressBar: document.getElementById("uploadProgressBar"),
      progressPercent: document.getElementById("uploadProgressPercent"),
      workingState: document.querySelector(".upload-state-working"),
      successState: document.getElementById("uploadStateSuccess"),
      statusMsg: document.querySelector(".upload-status-message"),
    };
  },
  showWorking(message, percentLabel = "0%", width = "0%") {
    const els = this.els();
    if (!els.container) return false;
    els.container.classList.remove("d-none");
    els.workingState?.classList.remove("d-none");
    els.successState?.classList.add("d-none");
    if (els.statusMsg) els.statusMsg.textContent = message;
    if (els.progressBar) els.progressBar.style.width = width;
    if (els.progressPercent) els.progressPercent.textContent = percentLabel;
    return true;
  },
  setProgress(percent) {
    const els = this.els();
    if (els.progressBar) els.progressBar.style.width = `${percent}%`;
    if (els.progressPercent) els.progressPercent.textContent = `${percent}%`;
  },
  showSuccess() {
    const els = this.els();
    els.workingState?.classList.add("d-none");
    els.successState?.classList.remove("d-none");
  },
  hide() {
    this.els().container?.classList.add("d-none");
  },
};

// The destination dropdown uses data-bs-auto-close="outside" so in-menu tab
// clicks and search typing don't dismiss it; selecting an item closes it here.
function closeDestinationDropdown() {
  const selector = document.getElementById("channelDropdownSelector");
  if (selector) {
    const bsDropdown = bootstrap.Dropdown.getInstance(selector);
    if (bsDropdown) bsDropdown.hide();
  }
}

// Shared: open (or create) the DM room with a user and switch to it
async function openDmWithUser(userId) {
  const resolved = (store.get("resolvedDms") || []).find((d) => d.id === userId);
  let conversationId = resolved?.conversationId;

  if (!conversationId) {
    try {
      const result = await wsClient.request("dm.open", { userId });
      conversationId = result.room.id;
      await loadInitialData();
    } catch (err) {
      console.error("Failed to open DM:", err);
      return;
    }
  }

  setActiveDestination("dm", conversationId);
  await loadConversationHistory({ type: "dm", value: conversationId }, conversationId);
  markConversationAsRead(conversationId);
}

// Replace the session user with a freshly mapped wire profile, remembering the
// last status the server confirmed (consumed by the presence-sync subscriber).
function applySessionProfile(profileWire) {
  const profile = MAPPERS.profile(profileWire);
  store.set("session.user", { ...profile, lastSyncedStatus: profile.status });
  return profile;
}

// Switch the visible room: update both destination atoms, clear the room's
// unread badge, and drop any stale typing indicator from the previous room.
function setActiveDestination(type, value) {
  store.set("activeDest", { type, value });
  store.set("activeDestKey", `${type}_${value}`);
  store.set(`notifications.${type}_${value}`, 0);
  store.set("typingState.active", false);
}

function seedPreferencesForm(prefs) {
  const user = store.get("session.user") || {};
  store.set("preferencesForm", {
    ...store.get("preferencesForm"),
    theme: prefs.theme,
    sound: prefs.sound,
    desktopNotif: prefs.desktopNotif,
    dmPrivacy: prefs.dmPrivacy,
    groupPrivacy: prefs.groupPrivacy,
    nameColor: user.nameColor || "#0284c7",
    isPremium: !!user.isPremium,
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    newEmail: "",
  });
}

function clearAuthenticatedState(message = null, toastType = "info") {
  TOKENS.clear();
  wsClient.disconnect();
  store.set("session.loggedIn", false);
  store.set("session.user", null);
  store.set("accountSecurity", {
    email: "",
    emailVerifiedAt: null,
    pendingEmail: null,
    isVerified: false,
  });
  store.set("sessionList", []);
  store.set("resolvedDms", []);
  store.set("messages", {});
  store.set("groupList", []);
  store.set("notifications", {});
  setActiveDestination("channel", "general");
  handlers.showSignInTab();
  if (message) {
    ToastService.show(message, toastType);
  }
}

async function refreshAccountSecurityState() {
  const data = await apiFetch("/api/auth/account");
  store.set("accountSecurity", {
    email: data.email || "",
    emailVerifiedAt: data.emailVerifiedAt || null,
    pendingEmail: data.pendingEmail || null,
    isVerified: !!data.emailVerifiedAt,
  });
}

async function loadSessionList() {
  const data = await apiFetch("/api/auth/sessions");
  store.set("sessionList", data.sessions || []);
}

async function completePendingEmailChangeToken(token) {
  await apiFetch("/api/auth/email-change/complete", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
  await refreshAccountSecurityState();
  await loadSessionList();
  ToastService.show("Email address updated successfully.", "success");
}

function removeSecurityQueryParam(name) {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(name)) return;
  url.searchParams.delete(name);
  window.history.replaceState({}, "", url.toString());
}

async function handleSecurityQueryParams() {
  const url = new URL(window.location.href);
  const verifyToken = url.searchParams.get("verify_email");
  const resetToken = url.searchParams.get("reset_password");
  const emailChangeToken = url.searchParams.get("change_email");

  if (verifyToken) {
    try {
      await apiFetch("/api/auth/verify-email/complete", {
        method: "POST",
        body: JSON.stringify({ token: verifyToken }),
      });
      removeSecurityQueryParam("verify_email");
      if (store.get("session.loggedIn")) {
        await refreshAccountSecurityState();
      }
      ToastService.show("Email verified successfully.", "success");
    } catch (err) {
      console.error("Email verification failed:", err);
    }
  }

  if (resetToken) {
    store.set("authState.resetMode", true);
    store.set("authState.resetToken", resetToken);
    removeSecurityQueryParam("reset_password");
  }

  if (emailChangeToken) {
    removeSecurityQueryParam("change_email");
    if (store.get("session.loggedIn")) {
      try {
        await completePendingEmailChangeToken(emailChangeToken);
      } catch (err) {
        console.error("Email change completion failed:", err);
      }
    } else {
      store.set("authState.pendingEmailChangeToken", emailChangeToken);
      ToastService.show("Sign in to complete your email change.", "info");
    }
  }
}

// Post-auth bootstrap shared by sign-in, sign-up and session restore
async function afterLogin(profileWire) {
  applySessionProfile(profileWire);
  store.set("session.loggedIn", true);

  await wsClient.connect();

  try {
    const prefsRes = await wsClient.request("preferences.get", {});
    const prefs = MAPPERS.preferences(prefsRes.preferences);
    store.set("prefs", prefs);
    applyTheme(prefs.theme);
    seedPreferencesForm(prefs);
  } catch (err) {
    console.warn("Failed to load preferences:", err);
  }

  try {
    await refreshAccountSecurityState();
  } catch (err) {
    console.warn("Failed to load account security state:", err);
  }

  await loadInitialData();

  const pendingEmailChangeToken = store.get("authState.pendingEmailChangeToken");
  if (pendingEmailChangeToken) {
    store.set("authState.pendingEmailChangeToken", "");
    try {
      await completePendingEmailChangeToken(pendingEmailChangeToken);
    } catch (err) {
      console.error("Deferred email change completion failed:", err);
    }
  }
}

// Presentation constants for the visitor-profile status badge.
const STATUS_BADGES = {
  online: {
    dot: "#10B981",
    text: "Online",
    class: "status-badge-online",
    glow: "rgba(16, 185, 129, 0.4)",
  },
  idle: {
    dot: "#F59E0B",
    text: "Idle",
    class: "status-badge-idle",
    glow: "rgba(245, 158, 11, 0.4)",
  },
  dnd: {
    dot: "#EF4444",
    text: "Do Not Disturb",
    class: "status-badge-dnd",
    glow: "rgba(239, 68, 68, 0.4)",
  },
  offline: {
    dot: "#9CA3AF",
    text: "Offline",
    class: "status-badge-offline",
    glow: "rgba(156, 163, 175, 0)",
  },
};

// Load a user's profile into visitorProfile state and open the profile modal.
// Shared by the message header click, group-member list, and reaction popover.
async function openUserProfileById(userId) {
  if (!userId) return;
  const currentUser = store.get("session.user");

  try {
    const profileRes = await wsClient.request("profile.get", { userId });
    const profile = MAPPERS.profile(profileRes.profile);
    const isSelf = !!(currentUser && profile.id === currentUser.id);
    const st = STATUS_BADGES[profile.status] || STATUS_BADGES.offline;

    // Mutual groups: probe each of my groups' member lists for the target user.
    let mutualGroups = [];
    if (!isSelf) {
      const groups = store.get("groupList") || [];
      const results = await Promise.all(groups.map(async (g) => {
        try {
          const res = await wsClient.request("group.members", { groupId: g.id });
          return res.members.some((m) => m.id === profile.id) ? { id: g.id, name: g.name } : null;
        } catch {
          return null;
        }
      }));
      mutualGroups = results.filter(Boolean);
    }

    store.set("visitorProfile", {
      id: profile.id,
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      statusColor: st.dot,
      statusGlow: st.glow,
      statusBadgeClass: st.class,
      statusText: st.text,
      joinedDate: profile.joinedDate,
      messagesSent: profile.messagesSent,
      reactionsAdded: profile.reactionsAdded,
      repliesMade: profile.repliesMade,
      isPremium: !!profile.isPremium,
      mutualGroups,
      mutualGroupsCount: mutualGroups.length,
      coverStyle: coverStyleFor(profile.coverUrl, profile.coverIndex),
      nameColor: profile.nameColor || "var(--text-dark)",
      isSelf,
      handleDisplay: `@${profile.username}`,
    });

    showModal("visitorProfileModal");
  } catch (err) {
    console.error("View profile failed:", err);
  }
}

// ── Event Handlers ───────────────────────────────────────────────
const handlers = {
  async toggleTheme() {
    const currentTheme = store.get("prefs.theme");
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    store.set("prefs.theme", nextTheme);
    applyTheme(nextTheme);
    seedPreferencesForm(store.get("prefs"));

    if (store.get("session.loggedIn")) {
      try {
        await wsClient.request("preferences.update", {
          sound: !!store.get("prefs.sound"),
          desktopNotifications: !!store.get("prefs.desktopNotif"),
          dmPrivacy: store.get("prefs.dmPrivacy"),
          groupPrivacy: store.get("prefs.groupPrivacy"),
          theme: nextTheme,
        });
      } catch (err) {
        console.warn("Failed to update theme on server:", err);
      }
    }
  },

  scrollToMessage(e, el) {
    e?.stopPropagation?.();
    const targetId = el.getAttribute("data-target-id");
    if (!targetId) return;
    const msgEl = document.getElementById(`group_${targetId}`) ||
      document.getElementById(`msg_${targetId}`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
      msgEl.classList.add("message-highlight");
      setTimeout(() => {
        msgEl.classList.remove("message-highlight");
      }, 2000);
    }
  },

  showSignInTab() {
    store.set("authState.resetMode", false);
    store.set("authState.activeTab", "signin");
    store.set("authState.signinClass", "active");
    store.set("authState.signupClass", "");
  },

  showSignUpTab() {
    store.set("authState.resetMode", false);
    store.set("authState.activeTab", "signup");
    store.set("authState.signinClass", "");
    store.set("authState.signupClass", "active");
  },

  showPasswordResetRequest() {
    store.set("authState.resetMode", true);
    store.set("authState.resetToken", "");
    store.set("authState.resetEmail", store.get("authState.signinEmail") || "");
    store.set("authState.resetNewPassword", "");
    store.set("authState.resetConfirmPassword", "");
  },

  cancelPasswordReset() {
    store.set("authState.resetMode", false);
    store.set("authState.resetToken", "");
    store.set("authState.resetNewPassword", "");
    store.set("authState.resetConfirmPassword", "");
    handlers.showSignInTab();
  },

  async handleSignIn() {
    const email = (store.get("authState.signinEmail") || "").trim();
    const pass = store.get("authState.signinPassword") || "";
    const rememberMe = !!store.get("authState.signinRememberMe");

    if (!email || !pass) {
      ToastService.show("All fields are required.", "warning");
      return;
    }

    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email,
          password: pass,
          rememberMe,
          deviceLabel: currentDeviceLabel(),
          captchaToken: CAPTCHA.consume("login"),
        }),
      });

      TOKENS.set({ accessToken: data.accessToken, refreshToken: data.refreshToken }, rememberMe);
      store.set("authState.signinEmail", "");
      store.set("authState.signinPassword", "");
      store.set("authState.signinRememberMe", false);

      await afterLogin(data.user);

      ToastService.show(
        `Welcome back to CentrumChat workspace, ${data.user.displayName}!`,
        "success",
      );
    } catch (err) {
      console.error("Sign in failed:", err);
    }
  },

  async handleSignUp() {
    const username = (store.get("authState.signupUsername") || "").trim();
    const email = (store.get("authState.signupEmail") || "").trim();
    const pass = store.get("authState.signupPassword") || "";
    const rememberMe = !!store.get("authState.signupRememberMe");

    if (!username || !email || !pass) {
      ToastService.show("All fields are required.", "warning");
      return;
    }

    if (pass.length < 8) {
      ToastService.show("Password must be at least 8 characters.", "warning");
      return;
    }

    try {
      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          username,
          email,
          password: pass,
          displayName: username,
          rememberMe,
          deviceLabel: currentDeviceLabel(),
          captchaToken: CAPTCHA.consume("register"),
        }),
      });

      TOKENS.set({ accessToken: data.accessToken, refreshToken: data.refreshToken }, rememberMe);
      store.set("authState.signupUsername", "");
      store.set("authState.signupEmail", "");
      store.set("authState.signupPassword", "");
      store.set("authState.signupRememberMe", false);

      await afterLogin(data.user);

      ToastService.show(`Welcome to CentrumChat workspace, ${data.user.displayName}!`, "success");
    } catch (err) {
      console.error("Sign up failed:", err);
    }
  },

  async handleLogout() {
    const tokens = TOKENS.get();
    if (tokens?.refreshToken) {
      try {
        await apiFetch("/api/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });
      } catch (err) {
        console.warn("Logout endpoint failed:", err);
      }
    }
    clearAuthenticatedState("Logged out successfully.", "info");
  },

  showChannelsTab() {
    store.set("searchState.activeTab", "channels");
  },
  showGroupsTab() {
    store.set("searchState.activeTab", "groups");
  },
  showUsersTab() {
    store.set("searchState.activeTab", "users");
  },

  async selectChannel(e, el) {
    e?.preventDefault?.();
    const slug = el.getAttribute("data-id");
    setActiveDestination("channel", slug);
    closeDestinationDropdown();
    const chan = (store.get("channelList") || []).find((c) => c.slug === slug);
    if (chan) {
      await loadConversationHistory({ type: "channel", value: slug }, chan.id);
      markConversationAsRead(chan.id);
    }
  },

  async selectGroup(e, el) {
    e?.preventDefault?.();
    const groupId = el.getAttribute("data-id");
    setActiveDestination("group", groupId);
    closeDestinationDropdown();
    await loadConversationHistory({ type: "group", value: groupId }, groupId);
    markConversationAsRead(groupId);
  },

  async selectDm(e, el) {
    e?.preventDefault?.();
    const userId = el.getAttribute("data-id");
    closeDestinationDropdown();
    await openDmWithUser(userId);
  },

  closeProfileDropdown() {
    const btn = document.getElementById("profileDropdownBtn");
    if (btn) {
      const bsDropdown = bootstrap.Dropdown.getInstance(btn);
      if (bsDropdown) bsDropdown.hide();
    }
  },

  startProfileEdit() {
    const user = store.get("session.user") || {};
    store.set("session.profileDraft.displayName", user.displayName || "");
    store.set("session.profileDraft.bio", user.bio || CONFIG.defaultBio);
    store.set("session.isEditingProfile", true);
  },

  cancelProfileEdit() {
    store.set("session.isEditingProfile", false);
  },

  async saveProfileEdit() {
    const draft = store.get("session.profileDraft") || {};
    const displayName = (draft.displayName || "").trim();
    const bio = (draft.bio || "").trim();
    if (!displayName) {
      ToastService.show("Display name cannot be empty.", "warning");
      return;
    }
    try {
      const profileRes = await wsClient.request("profile.update", {
        displayName,
        bio: bio || CONFIG.defaultBio,
      });
      applySessionProfile(profileRes.profile);
      store.set("session.isEditingProfile", false);
      ToastService.show("Profile updated successfully.", "success");
    } catch (err) {
      console.error("Profile save failed:", err);
      ToastService.show("Failed to update profile.", "error");
    }
  },

  async rotateAvatarSeed() {
    const currentUser = store.get("session.user");
    const seeds = CONFIG.avatarSeeds;
    let seed = seeds[Math.floor(Math.random() * seeds.length)];
    if (seed === currentUser?.avatarSeed) {
      seed = `${seed}-${Math.random().toString(36).slice(2, 6)}`;
    }

    try {
      const profileRes = await wsClient.request("profile.update", { avatarSeed: seed });
      applySessionProfile(profileRes.profile);
      ToastService.show("Avatar regenerated successfully.", "success");
    } catch (err) {
      console.error("Avatar rotate failed:", err);
    }
  },

  async openPreferences() {
    const user = store.get("session.user");
    if (!user) return;

    seedPreferencesForm(store.get("prefs"));
    store.set("preferencesForm.activeTab", "appearance");
    try {
      await refreshAccountSecurityState();
      await loadSessionList();
    } catch (err) {
      console.warn("Failed to load account security details:", err);
    }

    handlers.closeProfileDropdown();

    showModal("preferencesModal");
  },

  showPrefAppearanceTab() {
    store.set("preferencesForm.activeTab", "appearance");
  },
  showPrefPrivacyTab() {
    store.set("preferencesForm.activeTab", "privacy");
  },
  showPrefSecurityTab() {
    store.set("preferencesForm.activeTab", "security");
  },

  setPrefThemeLight() {
    store.set("preferencesForm.theme", "light");
  },
  setPrefThemeDark() {
    store.set("preferencesForm.theme", "dark");
  },

  async updatePassword() {
    const currentPass = store.get("preferencesForm.currentPassword");
    const newPass = store.get("preferencesForm.newPassword");
    const confirmPass = store.get("preferencesForm.confirmPassword");

    if (!currentPass || !newPass || !confirmPass) {
      ToastService.show("All password fields are required.", "warning");
      return;
    }

    if (newPass.length < 8) {
      ToastService.show("New password must be at least 8 characters.", "warning");
      return;
    }

    if (newPass !== confirmPass) {
      ToastService.show("Confirm password does not match.", "warning");
      return;
    }

    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass }),
      });
      ToastService.show("Password updated successfully!", "success");

      store.set("preferencesForm.currentPassword", "");
      store.set("preferencesForm.newPassword", "");
      store.set("preferencesForm.confirmPassword", "");
    } catch (err) {
      console.error("Password update failed:", err);
    }
  },

  async requestPasswordReset() {
    const email = (store.get("authState.resetEmail") || "").trim();
    if (!email) {
      ToastService.show("Email is required.", "warning");
      return;
    }
    try {
      const data = await apiFetch("/api/auth/password-reset/request", {
        method: "POST",
        body: JSON.stringify({ email, captchaToken: CAPTCHA.consume("password_reset") }),
      });
      ToastService.show(data.message || "Password reset requested.", "info");
      handlers.cancelPasswordReset();
    } catch (err) {
      console.error("Password reset request failed:", err);
    }
  },

  async completePasswordReset() {
    const token = store.get("authState.resetToken");
    const newPassword = store.get("authState.resetNewPassword") || "";
    const confirmPassword = store.get("authState.resetConfirmPassword") || "";
    if (!token || !newPassword || !confirmPassword) {
      ToastService.show("All password reset fields are required.", "warning");
      return;
    }
    if (newPassword.length < 8) {
      ToastService.show("New password must be at least 8 characters.", "warning");
      return;
    }
    if (newPassword !== confirmPassword) {
      ToastService.show("Confirm password does not match.", "warning");
      return;
    }
    try {
      await apiFetch("/api/auth/password-reset/complete", {
        method: "POST",
        body: JSON.stringify({ token, newPassword }),
      });
      store.set("authState.resetToken", "");
      store.set("authState.resetNewPassword", "");
      store.set("authState.resetConfirmPassword", "");
      store.set("authState.resetMode", false);
      ToastService.show("Password reset successfully. Sign in with your new password.", "success");
      handlers.showSignInTab();
    } catch (err) {
      console.error("Password reset completion failed:", err);
    }
  },

  async resendVerificationEmail() {
    try {
      const data = await apiFetch("/api/auth/verify-email/resend", { method: "POST" });
      await refreshAccountSecurityState();
      if (data.alreadyVerified) {
        ToastService.show("Your email address is already verified.", "info");
      } else if (data.sent) {
        ToastService.show("Verification email sent.", "success");
      } else {
        ToastService.show("Verification email could not be sent right now.", "warning");
      }
    } catch (err) {
      console.error("Verification resend failed:", err);
    }
  },

  async revokeSession(e, el) {
    e?.preventDefault?.();
    const sessionId = el.getAttribute("data-session-id");
    if (!sessionId) return;
    try {
      const result = await apiFetch(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      if (result.revokedCurrent) {
        clearAuthenticatedState("Current session revoked. Please sign in again.", "warning");
        return;
      }
      await loadSessionList();
      ToastService.show("Session revoked.", "success");
    } catch (err) {
      console.error("Session revoke failed:", err);
    }
  },

  async revokeOtherSessions() {
    try {
      const result = await apiFetch("/api/auth/sessions/others", { method: "DELETE" });
      await loadSessionList();
      ToastService.show(
        `${result.revokedCount || 0} other session${result.revokedCount === 1 ? "" : "s"} revoked.`,
        "success",
      );
    } catch (err) {
      console.error("Revoke other sessions failed:", err);
    }
  },

  async startEmailChange() {
    const currentPassword = store.get("preferencesForm.currentPassword") || "";
    const newEmail = (store.get("preferencesForm.newEmail") || "").trim();
    if (!currentPassword || !newEmail) {
      ToastService.show("Current password and new email are required.", "warning");
      return;
    }
    try {
      await apiFetch("/api/auth/email-change/start", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newEmail }),
      });
      store.set("preferencesForm.newEmail", "");
      await refreshAccountSecurityState();
      ToastService.show("Check your new email address to complete the change.", "success");
    } catch (err) {
      console.error("Email change start failed:", err);
    }
  },

  async savePreferences() {
    const updatedColor = store.get("preferencesForm.nameColor");
    const contrastRatio = HELPERS.getContrastRatio(updatedColor, "#ffffff");

    if (contrastRatio < 3.0) {
      ToastService.show(
        `Contrast ratio is too low for light mode (Contrast: ${
          contrastRatio.toFixed(1)
        }:1). Please pick a darker name color.`,
        "warning",
      );
      return;
    }

    const targetTheme = store.get("preferencesForm.theme");
    applyTheme(targetTheme);

    try {
      const isPremium = !!store.get("preferencesForm.isPremium");
      const profileRes = await wsClient.request("profile.update", {
        nameColor: updatedColor,
        isPremium,
      });
      applySessionProfile(profileRes.profile);

      const prefsRes = await wsClient.request("preferences.update", {
        sound: !!store.get("preferencesForm.sound"),
        desktopNotifications: !!store.get("preferencesForm.desktopNotif"),
        dmPrivacy: store.get("preferencesForm.dmPrivacy"),
        groupPrivacy: store.get("preferencesForm.groupPrivacy"),
        theme: targetTheme,
      });
      const prefs = MAPPERS.preferences(prefsRes.preferences);
      store.set("prefs", prefs);

      if (prefs.desktopNotif && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
      }

      hideModal("preferencesModal");

      ToastService.show("Preferences saved successfully!", "success");
    } catch (err) {
      console.error("Preferences save failed:", err);
    }
  },

  toggleSearch() {
    const current = store.get("searchState.searchOpen");
    store.set("searchState.searchOpen", !current);
    if (!current) {
      setTimeout(() => {
        const input = document.getElementById("messageSearchInput");
        if (input) input.focus();
      }, 100);
    } else {
      store.set("searchState.messageQuery", "");
    }
  },

  clearMessageSearch() {
    store.set("searchState.messageQuery", "");
    const input = document.getElementById("messageSearchInput");
    if (input) input.focus();
  },

  triggerFileAttach() {
    showModal("uploadAttachmentModal");
  },

  clickHiddenUploadInput() {
    const fileInput = document.getElementById("modalFileInput");
    if (fileInput) fileInput.click();
  },

  async modalUploadFile(file) {
    if (!file) return;
    if (!UploadOverlay.showWorking("Uploading file...")) return;

    // XMLHttpRequest instead of fetch: upload progress events need xhr.upload.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media/upload");

    const tokens = TOKENS.get();
    if (tokens?.accessToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${tokens.accessToken}`);
    }

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        UploadOverlay.setProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        ToastService.show("Upload failed. Please try again.", "error");
        UploadOverlay.hide();
        return;
      }
      try {
        const res = JSON.parse(xhr.responseText);
        const attachmentId = res.data?.attachmentId;
        const freshTokens = TOKENS.get();
        const tokenParam = freshTokens?.accessToken
          ? `?token=${encodeURIComponent(freshTokens.accessToken)}`
          : "";

        store.set("chatForm.attachedFileDetails", {
          name: file.name,
          size: file.size,
          type: file.type,
          isImage: file.type.startsWith("image/"),
          url: `/media/${attachmentId}${tokenParam}`,
          sizeFormatted: HELPERS.formatBytes(file.size),
        });
        store.set("chatForm.attachedFileId", attachmentId);

        UploadOverlay.showSuccess();
        setTimeout(() => {
          hideModal("uploadAttachmentModal");
          UploadOverlay.hide();
        }, 1000);
      } catch (err) {
        console.error("Parse error:", err);
        ToastService.show("Upload complete, but failed to parse response.", "error");
        UploadOverlay.hide();
      }
    };

    xhr.onerror = () => {
      ToastService.show("Network error during upload.", "error");
      UploadOverlay.hide();
    };

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  },

  async uploadFromUrl() {
    const urlInput = document.getElementById("uploadUrlInput");
    const url = urlInput?.value.trim();
    if (!url) {
      ToastService.show("Please enter a valid URL.", "warning");
      return;
    }

    UploadOverlay.showWorking("Fetching file from URL...", "Connecting...", "50%");

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Fetch failed");
      const blob = await res.blob();

      let filename = "pasted-file";
      try {
        const lastPart = new URL(url).pathname.split("/").pop();
        filename = lastPart && lastPart.includes(".")
          ? lastPart
          : `pasted-file.${blob.type.split("/")[1] || "bin"}`;
      } catch (_) { /* keep the default name */ }

      urlInput.value = "";
      handlers.modalUploadFile(new File([blob], filename, { type: blob.type }));
    } catch (err) {
      console.error("Failed to fetch URL:", err);
      ToastService.show(
        "Failed to retrieve file from URL. (CORS restriction or invalid link)",
        "error",
      );
      UploadOverlay.hide();
    }
  },

  clearAttachedFile() {
    store.set("chatForm.attachedFileId", null);
    store.set("chatForm.attachedFileDetails", null);
  },

  handleMessageInputKeydown(e) {
    sendTypingStart(activeConversationId());

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handlers.handleSendMessage();
    }
  },

  async handleSendMessage() {
    const text = (store.get("chatForm.messageInput") || "").trim();
    const attachmentId = store.get("chatForm.attachedFileId");
    const replyTarget = store.get("replyTarget");

    if (!text && !attachmentId) return;

    const conversationId = activeConversationId();
    if (!conversationId) return;

    sendTypingStop(conversationId);

    try {
      if (replyTarget && replyTarget.isEdit) {
        await wsClient.request("message.edit", {
          messageId: replyTarget.id,
          content: text,
        });
      } else {
        await wsClient.request("message.send", {
          conversationId,
          content: text,
          replyToId: replyTarget ? replyTarget.id : undefined,
          attachmentId: attachmentId || undefined,
        });
      }

      store.set("chatForm.messageInput", "");
      store.set("chatForm.attachedFileId", null);
      store.set("chatForm.attachedFileDetails", null);
      store.set("replyTarget", null);
    } catch (err) {
      console.error("Failed to send/edit message:", err);
    }
  },

  cancelReply() {
    const replyTarget = store.get("replyTarget");
    store.set("replyTarget", null);
    if (replyTarget && replyTarget.isEdit) {
      store.set("chatForm.messageInput", "");
    }
  },

  startReply(e, el) {
    const msgId = el.getAttribute("data-id");
    const msg = ChatService.getMessageById(msgId);
    if (msg) {
      const author = store.get(`users.${msg.authorId}`);
      store.set("replyTarget", {
        id: msg.id,
        displayName: author?.displayName || "Unknown",
        content: msg.content,
        isEdit: false,
      });
      const input = document.getElementById("messageInput");
      if (input) input.focus();
    }
  },

  startEditMsg(e, el) {
    const msgId = el.getAttribute("data-id");
    const msg = ChatService.getMessageById(msgId);
    if (msg) {
      store.set("replyTarget", {
        id: msg.id,
        displayName: "Editing message",
        content: msg.content,
        isEdit: true,
      });
      store.set("chatForm.messageInput", msg.content);
      const input = document.getElementById("messageInput");
      if (input) input.focus();
    }
  },

  deleteMsg(e, el) {
    store.set("session.messageToDeleteId", el.getAttribute("data-id"));
    showModal("deleteMessageConfirmModal");
  },

  async confirmDeleteMsg() {
    const msgId = store.get("session.messageToDeleteId");
    if (!msgId) return;
    try {
      await wsClient.request("message.delete", { messageId: msgId, confirm: true });
      ToastService.show("Message deleted.", "info");

      hideModal("deleteMessageConfirmModal");
    } catch (err) {
      console.error("Message deletion failed:", err);
      ToastService.show("Failed to delete message.", "error");
    } finally {
      store.set("session.messageToDeleteId", null);
    }
  },

  showMsgReactionPicker(e, el) {
    e.stopPropagation();
    const msgId = el.getAttribute("data-id");
    const popover = document.getElementById("emojiPopoverContainer");
    if (!popover) return;

    popover.setAttribute("data-purpose", "reaction");
    popover.setAttribute("data-target-msg-id", msgId);

    if (window.innerWidth <= 1024) {
      popover.style.top = "";
      popover.style.left = "";
      popover.style.bottom = "";
      popover.style.right = "";
      popover.className = "emoji-picker-popover mobile-docked";
    } else {
      const rect = el.getBoundingClientRect();
      const cardEl = document.querySelector(".glass-card");
      const cardRect = cardEl
        ? cardEl.getBoundingClientRect()
        : { top: 0, left: 0, width: window.innerWidth };

      const pickerHeight = 435;
      const pickerWidth = 352;

      let top = rect.top - cardRect.top - pickerHeight - 10;
      let left = rect.left - cardRect.left - (pickerWidth / 2) + (rect.width / 2);

      if (top < 10) top = rect.bottom - cardRect.top + 10;
      if (left < 10) left = 10;
      else if (left + pickerWidth > cardRect.width - 10) left = cardRect.width - pickerWidth - 10;

      popover.style.top = `${top}px`;
      popover.style.left = `${left}px`;
      popover.style.bottom = "auto";
      popover.style.right = "auto";
      popover.className = "emoji-picker-popover desktop-reaction";
    }

    ensureEmojiPickerMounted();
  },

  async toggleReaction(e, el) {
    const msgId = el.getAttribute("data-msg-id");
    const emoji = el.getAttribute("data-emoji");
    if (e && e.ctrlKey) {
      const msg = ChatService.getMessageById(msgId);
      if (msg && msg.reactions && msg.reactions[emoji]) {
        showReactionUsersPopover(el, emoji, msg.reactions[emoji]);
      }
      return;
    }
    try {
      await wsClient.request("reaction.toggle", { messageId: msgId, emoji });
    } catch (err) {
      console.error("Toggle reaction failed:", err);
    }
  },

  scrollToBottom() {
    const stream = document.getElementById("messageStream");
    if (stream) {
      stream.scrollTo({ top: stream.scrollHeight, behavior: "smooth" });
    }
  },

  openLightbox(e, el) {
    e?.stopPropagation?.();
    const src = el.getAttribute("src");
    store.set("lightbox.imgSrc", src || "");
    store.set("lightbox.open", true);
  },

  closeLightbox() {
    store.set("lightbox.open", false);
    store.set("lightbox.imgSrc", "");
  },

  openProfileImagesModal() {
    store.set("profileImagesForm", {
      avatarFile: null,
      coverFile: null,
    });

    const file1 = document.getElementById("avatarFileInput");
    const file2 = document.getElementById("coverFileInput");
    if (file1) file1.value = "";
    if (file2) file2.value = "";

    handlers.closeProfileDropdown();

    showModal("profileImagesModal");
  },

  handleAvatarFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      store.set("profileImagesForm.avatarFile", file);
      ToastService.show(`Selected avatar file: ${file.name}`, "info");
    }
  },

  handleCoverFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      store.set("profileImagesForm.coverFile", file);
      ToastService.show(`Selected cover file: ${file.name}`, "info");
    }
  },

  async saveProfileGraphics() {
    const avatarFile = store.get("profileImagesForm.avatarFile");
    const coverFile = store.get("profileImagesForm.coverFile");

    try {
      if (avatarFile) {
        const formData = new FormData();
        formData.append("file", avatarFile);
        const res = await apiFetch("/api/media/avatar", {
          method: "POST",
          body: formData,
        });
        const user = store.get("session.user");
        store.set("session.user", { ...user, avatarUrl: res.avatarUrl });
      }

      if (coverFile) {
        const formData = new FormData();
        formData.append("file", coverFile);
        const res = await apiFetch("/api/media/cover", {
          method: "POST",
          body: formData,
        });
        const user = store.get("session.user");
        store.set("session.user", { ...user, coverUrl: res.coverUrl });
      }

      hideModal("profileImagesModal");

      ToastService.show("Profile graphics updated successfully!", "success");
    } catch (err) {
      console.error("Graphics update failed:", err);
    }
  },

  async viewUserProfile(e, el) {
    await openUserProfileById(el.getAttribute("data-user-id"));
  },

  openPrefsFromProfile() {
    setTimeout(() => {
      handlers.openPreferences();
    }, 300);
  },

  openProfileImagesFromProfile() {
    setTimeout(() => {
      handlers.openProfileImagesModal();
    }, 300);
  },

  messageUserFromProfile() {
    const visitorId = store.get("visitorProfile.id");
    if (visitorId) {
      openDmWithUser(visitorId);
    }
  },

  mentionUserFromProfile() {
    const visitor = store.get("visitorProfile.username");
    const currentVal = store.get("chatForm.messageInput") || "";
    store.set("chatForm.messageInput", `@${visitor} ` + currentVal);
    const input = document.getElementById("messageInput");
    if (input) input.focus();
  },

  async toggleBlockFromProfile() {
    const userId = store.get("visitorProfile.id");
    if (!userId || !window.confirm("Block this user and disable direct interaction?")) return;
    try {
      await apiFetch("/api/safety/blocks/" + encodeURIComponent(userId), { method: "PUT" });
      hideModal("visitorProfileModal");
      ToastService.show("User blocked.", "info");
    } catch (error) {
      console.error("Block action failed:", error);
    }
  },

  async unblockFromProfile() {
    const userId = store.get("visitorProfile.id");
    if (!userId) return;
    try {
      await apiFetch("/api/safety/blocks/" + encodeURIComponent(userId), { method: "DELETE" });
      ToastService.show("User unblocked.", "info");
    } catch (error) {
      console.error("Unblock action failed:", error);
    }
  },

  async reportUserFromProfile() {
    const userId = store.get("visitorProfile.id");
    if (userId) await submitSafetyReport("user", userId);
  },

  async reportMessage(_event, element) {
    const messageId = element.getAttribute("data-id");
    if (messageId) await submitSafetyReport("message", messageId);
  },

  async reportAttachment(_event, element) {
    const attachmentId = element.getAttribute("data-id");
    if (attachmentId) await submitSafetyReport("attachment", attachmentId);
  },

  openCreateGroup() {
    const resolvedDms = store.get("resolvedDms") || [];
    const dmCandidates = resolvedDms.map((d) => ({
      id: d.id,
      username: d.username,
      displayName: d.displayName,
      avatarUrl: d.avatarUrl,
    }));

    store.set("createGroupForm", {
      name: "",
      candidateUsers: dmCandidates,
      selectedUserIds: [],
    });

    showModal("createGroupModal");
  },

  toggleGroupMemberSelection(e, el) {
    const val = el.value;
    let selected = [...(store.get("createGroupForm.selectedUserIds") || [])];
    if (el.checked) {
      if (!selected.includes(val)) selected.push(val);
    } else {
      selected = selected.filter((x) => x !== val);
    }
    store.set("createGroupForm.selectedUserIds", selected);
  },

  async submitCreateGroup() {
    const name = (store.get("createGroupForm.name") || "").trim();
    if (!name) {
      ToastService.show("Please enter a group name.", "warning");
      return;
    }

    const memberIds = store.get("createGroupForm.selectedUserIds") || [];
    if (memberIds.length < 2) {
      ToastService.show("A group must have at least 3 members (you + 2 others).", "warning");
      return;
    }

    try {
      const result = await wsClient.request("group.create", { name, memberIds });
      hideModal("createGroupModal");

      setActiveDestination("group", result.room.id);

      await loadInitialData();

      ToastService.show(`Group "${name}" created successfully!`, "success");
    } catch (err) {
      console.error("Group creation failed:", err);
    }
  },

  async openGroupMembers() {
    const dest = store.get("activeDest");
    if (!dest || dest.type !== "group") return;

    try {
      const result = await wsClient.request("group.members", { groupId: dest.value });
      const currentUser = store.get("session.user");
      const groups = store.get("groupList") || [];
      const currentGroup = groups.find((g) => g.id === dest.value);

      const members = result.members.map((m) => {
        const summary = MAPPERS.userSummary(m);
        const isOwner = currentGroup?.ownerId === m.id;
        const isSelf = currentUser.id === m.id;
        const canKick = currentGroup?.ownerId === currentUser.id && !isSelf;
        return { ...summary, isPremium: !!m.isPremium, isOwner, canKick };
      });

      const resolvedDms = store.get("resolvedDms") || [];
      const potential = resolvedDms.filter((d) => !result.members.some((m) => m.id === d.id));

      store.set("groupMembersForm", {
        members,
        canAddMembers: result.members.some((m) => m.id === currentUser.id),
        addableUsers: potential,
      });

      // The add-member <select> options are managed imperatively: HTML parsing
      // drops unknown tags (like <for>) inside <select>, so no template loop here.
      const select = document.getElementById("newGroupMemberSelect");
      if (select) {
        select.innerHTML = "";
        for (const u of potential) {
          const opt = document.createElement("option");
          opt.value = u.id;
          opt.textContent = `@${u.username} (${u.displayName})`;
          select.appendChild(opt);
        }
      }

      showModal("groupMembersModal");
    } catch (err) {
      console.error("Open group members failed:", err);
    }
  },

  async kickGroupMember(e, el) {
    e.stopPropagation();
    const dest = store.get("activeDest");
    const userId = el.getAttribute("data-user-id");
    if (!userId) return;

    try {
      await wsClient.request("group.removeMember", { groupId: dest.value, userId });
      ToastService.show("Member kicked out.", "info");
      await loadInitialData();
      await handlers.openGroupMembers();
    } catch (err) {
      console.error("Kick member failed:", err);
    }
  },

  async submitAddGroupMember() {
    const dest = store.get("activeDest");
    const select = document.getElementById("newGroupMemberSelect");
    const userId = select ? select.value : "";
    if (!userId) return;

    try {
      await wsClient.request("group.addMember", { groupId: dest.value, userId });
      ToastService.show("Member added successfully!", "success");
      await loadInitialData();
      await handlers.openGroupMembers();
    } catch (err) {
      console.error("Add member failed:", err);
    }
  },

  async leaveGroup() {
    const dest = store.get("activeDest");
    try {
      await wsClient.request("group.leave", { groupId: dest.value });
      ToastService.show("You left the group.", "info");

      hideModal("groupMembersModal");

      setActiveDestination("channel", "general");

      await loadInitialData();
    } catch (err) {
      console.error("Leave group failed:", err);
    }
  },

  viewUserProfileFromGroup(e, el) {
    if (e?.target?.closest?.(".kick-member-btn")) return;
    const userId = el.getAttribute("data-user-id");
    hideModal("groupMembersModal");

    setTimeout(() => openUserProfileById(userId), 300);
  },

  toggleEmojiPicker() {
    const popover = document.getElementById("emojiPopoverContainer");
    if (!popover) return;

    const pickerVisible = popover.classList.contains("mobile-docked") ||
      popover.classList.contains("desktop-compose") ||
      popover.classList.contains("desktop-reaction");
    const isReaction = popover.getAttribute("data-purpose") === "reaction";

    if (pickerVisible && !isReaction) {
      popover.className = "emoji-picker-popover";
    } else {
      popover.style.top = "";
      popover.style.left = "";
      popover.style.bottom = "";
      popover.style.right = "";

      popover.setAttribute("data-purpose", "compose");
      popover.removeAttribute("data-target-msg-id");

      if (window.innerWidth <= 1024) {
        popover.className = "emoji-picker-popover mobile-docked";
      } else {
        popover.className = "emoji-picker-popover desktop-compose";
      }
      ensureEmojiPickerMounted();
    }
  },
};

const ChatService = {
  getMessageById: (messageId) => {
    const key = store.get("activeDestKey");
    const destMsgs = store.get(`messages.${key}`) || [];
    return destMsgs.find((m) => m.id === messageId);
  },
};

function ensureEmojiPickerMounted() {
  const popover = document.getElementById("emojiPopoverContainer");
  if (!popover) return;

  const currentTheme = document.body.classList.contains("dark-mode") ? "dark" : "light";
  const activeTheme = popover.getAttribute("data-active-theme");

  if (activeTheme !== currentTheme) {
    popover.innerHTML = "";
  }

  if (!popover.hasChildNodes()) {
    popover.setAttribute("data-active-theme", currentTheme);
    const pickerOptions = {
      onEmojiSelect: async (emoji) => {
        const purpose = popover.getAttribute("data-purpose");
        if (purpose === "reaction") {
          const msgId = popover.getAttribute("data-target-msg-id");
          try {
            await wsClient.request("reaction.toggle", { messageId: msgId, emoji: emoji.native });
          } catch (err) {
            console.error("Reaction toggle failed:", err);
          }
        } else {
          const currentVal = store.get("chatForm.messageInput") || "";
          store.set("chatForm.messageInput", currentVal + emoji.native);
          const input = document.getElementById("messageInput");
          if (input) input.focus();
        }
        popover.className = "emoji-picker-popover";
      },
      theme: currentTheme,
      set: "apple",
      previewPosition: "none",
      navPosition: "bottom",
    };

    const picker = new EmojiMart.Picker(pickerOptions);
    popover.appendChild(picker);
  }
}

// Global click listener to close emoji picker when clicking outside
document.addEventListener("click", (e) => {
  const popover = document.getElementById("emojiPopoverContainer");
  const toggleBtn = document.getElementById("emojiToggleBtn");
  if (popover && toggleBtn) {
    if (
      !popover.contains(e.target) &&
      !toggleBtn.contains(e.target) &&
      !e.target.closest('[data-on-click="showMsgReactionPicker"]')
    ) {
      popover.className = "emoji-picker-popover";
    }
  }
});

// Setup Dark/Light mode on boot (server preference is applied again after login)
const savedDarkMode = STORAGE.getItem("chat_dark_mode");
if (savedDarkMode === "1") {
  document.body.classList.add("dark-mode");
} else {
  document.body.classList.remove("dark-mode");
}

// Scroll FAB handler
document.addEventListener("scroll", (e) => {
  const stream = document.getElementById("messageStream");
  const fab = document.getElementById("scrollBottomFab");
  if (!stream || !fab || e.target !== stream) return;

  const distFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
  if (distFromBottom > 120) {
    fab.classList.remove("d-none");
  } else {
    fab.classList.add("d-none");
  }
}, true);

// Context menu reaction user list
document.addEventListener("contextmenu", (e) => {
  const badge = e.target.closest(".reaction-badge");
  if (badge) {
    e.preventDefault();
    const msgId = badge.getAttribute("data-msg-id");
    const emoji = badge.getAttribute("data-emoji");
    const msg = ChatService.getMessageById(msgId);
    if (msg && msg.reactions && msg.reactions[emoji]) {
      showReactionUsersPopover(badge, emoji, msg.reactions[emoji]);
    }
  }
});

function showReactionUsersPopover(anchorEl, emoji, userIds) {
  const existing = document.getElementById("reactionUsersPopover");
  if (existing) existing.remove();

  if (!userIds || userIds.length === 0) return;

  const usersMap = store.get("users") || {};
  const currentUser = store.get("session.user");

  const avatarList = userIds.map((uid) => {
    const userSummary = usersMap[uid];
    const displayName = HELPERS.sanitize(userSummary ? userSummary.displayName : "Unknown");
    const isMe = currentUser && currentUser.id === uid;
    const avatarUrl = userSummary?.avatarUrl || HELPERS.dicebearUrl(uid);
    return `
      <div class="reaction-user-row" data-user-id="${uid}" style="cursor:pointer;">
        <img src="${avatarUrl}" alt="" class="reaction-user-avatar">
        <span class="reaction-user-name">${displayName}${
      isMe ? ' <span class="reaction-you-badge">you</span>' : ""
    }</span>
        <i class="bi bi-chevron-right reaction-user-chevron"></i>
      </div>
    `;
  }).join("");

  const popover = document.createElement("div");
  popover.id = "reactionUsersPopover";
  popover.className = "reaction-users-popover";
  popover.innerHTML = `
    <div class="reaction-popover-header">${HELPERS.sanitize(emoji)} · ${userIds.length} reaction${
    userIds.length > 1 ? "s" : ""
  }</div>
    <div class="reaction-popover-list">${avatarList}</div>
  `;

  document.body.appendChild(popover);

  const rect = anchorEl.getBoundingClientRect();
  popover.style.visibility = "hidden";
  popover.style.top = "-9999px";
  popover.style.left = "-9999px";

  requestAnimationFrame(() => {
    const popH = popover.offsetHeight || 180;
    const popW = popover.offsetWidth || 200;

    let top = rect.top - popH - 8;
    if (top < 8) top = rect.bottom + 8;

    let left = rect.left;
    if (left + popW > window.innerWidth - 8) {
      left = window.innerWidth - popW - 8;
    }
    if (left < 8) left = 8;

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
    popover.style.visibility = "";

    requestAnimationFrame(() => popover.classList.add("visible"));
  });

  popover.addEventListener("click", (evt) => {
    const row = evt.target.closest("[data-user-id]");
    if (!row) return;
    const uid = row.getAttribute("data-user-id");
    popover.classList.remove("visible");
    setTimeout(() => {
      popover.remove();
      openUserProfileById(uid);
    }, 180);
  });

  const dismiss = (evt) => {
    if (!popover.contains(evt.target)) {
      popover.classList.remove("visible");
      setTimeout(() => popover.remove(), 200);
      document.removeEventListener("click", dismiss, true);
      document.removeEventListener("scroll", dismiss, true);
    }
  };
  setTimeout(() => {
    document.addEventListener("click", dismiss, true);
    document.addEventListener("scroll", dismiss, true);
  }, 50);
}

// ── Message-map store updates ────────────────────────────────────
// The "messages" map is replaced wholesale (new object identity) so computeds
// depending on it re-run, but only the touched room's array is copied —
// untouched rooms keep their existing array references.
function setRoomMessages(destKey, msgs) {
  store.set("messages", { ...(store.get("messages") || {}), [destKey]: msgs });
}

function appendRoomMessage(destKey, message) {
  const rooms = store.get("messages") || {};
  setRoomMessages(destKey, [...(rooms[destKey] || []), message]);
}

// Find a message by id across all rooms and merge `patch` into it.
function patchMessageById(messageId, patch) {
  const rooms = store.get("messages") || {};
  for (const [key, msgs] of Object.entries(rooms)) {
    const idx = msgs.findIndex((m) => m.id === messageId);
    if (idx === -1) continue;
    const next = [...msgs];
    next[idx] = { ...msgs[idx], ...patch };
    store.set("messages", { ...rooms, [key]: next });
    return;
  }
}

// Helper to mark the latest message of a room as read
function markConversationAsRead(conversationId) {
  const key = store.get("activeDestKey");
  const msgs = store.get(`messages.${key}`) || [];
  const lastMsg = msgs[msgs.length - 1];
  if (lastMsg) {
    wsClient.request("room.markRead", { conversationId, messageId: lastMsg.id }).catch(() => {});
  }
}

// There is no profile.updated push in the protocol, so other users' profile
// changes (name color, premium, avatar) become visible by refetching authors
// as their messages arrive. Concurrent fetches for the same user share one
// request, but a fresh call always refetches — deliberately, so those
// changes show up immediately.
const inflightProfileFetches = new Map();

function refreshUserProfile(userId) {
  if (!userId) return Promise.resolve();
  const inflight = inflightProfileFetches.get(userId);
  if (inflight) return inflight;
  const request = (async () => {
    try {
      const res = await wsClient.request("profile.get", { userId });
      store.set(`users.${userId}`, MAPPERS.profile(res.profile));
    } catch (err) {
      console.warn(`Failed to fetch profile for user ${userId}:`, err);
    } finally {
      inflightProfileFetches.delete(userId);
    }
  })();
  inflightProfileFetches.set(userId, request);
  return request;
}

// Fetch any profiles referenced by messages that we don't know yet
async function ensureUsersKnown(userIds) {
  const unknown = [...new Set(userIds.filter((id) => id && !store.get(`users.${id}`)))];
  await Promise.all(unknown.map(refreshUserProfile));
}

// Helper to load room history
async function loadConversationHistory(dest, conversationId) {
  if (!conversationId) return;
  try {
    const historyResult = await wsClient.request("message.history", { conversationId, limit: 100 });
    const messages = historyResult.messages.map(MAPPERS.message);

    await ensureUsersKnown(messages.map((m) => m.authorId));

    setRoomMessages(`${dest.type}_${dest.value}`, messages);
  } catch (err) {
    console.error("Failed to load message history:", err);
  }
}

// App Initialization (session restore on page load)
function hideSplashLoader() {
  const loader = document.getElementById("app-splash-loader");
  if (loader) {
    loader.style.opacity = "0";
    loader.style.visibility = "hidden";
    setTimeout(() => {
      loader.remove();
    }, 400);
  }
}

async function initApp() {
  await CAPTCHA.initialize();
  await handleSecurityQueryParams();
  const tokens = TOKENS.get();
  if (!tokens) {
    store.set("session.loggedIn", false);
    hideSplashLoader();
    return;
  }

  try {
    if (!(await tryRefreshTokens())) {
      clearAuthenticatedState();
      hideSplashLoader();
      return;
    }
  } catch (err) {
    console.warn("Refresh failed, attempting with existing tokens:", err);
  }

  try {
    await wsClient.connect();
    const userId = parseJwt(TOKENS.get().accessToken).sub;
    const profileRes = await wsClient.request("profile.get", { userId });
    await afterLogin(profileRes.profile);
    hideSplashLoader();
  } catch (err) {
    console.error("Failed to restore session:", err);
    clearAuthenticatedState();
    hideSplashLoader();
  }
}

async function loadInitialData() {
  try {
    const [channelsResult, groupsResult, dmsResult] = await Promise.all([
      wsClient.request("channel.list", {}),
      wsClient.request("group.list", {}),
      wsClient.request("dm.list", {}),
    ]);
    store.set("channelList", channelsResult.channels.map(MAPPERS.conversation));
    store.set("groupList", groupsResult.groups.map(MAPPERS.conversation));

    const dmRooms = dmsResult.rooms.map(MAPPERS.conversation);
    const currentUser = store.get("session.user");

    // Resolve every DM partner in parallel; failures drop that room only.
    const resolvedDms = (await Promise.all(dmRooms.map(async (dmRoom) => {
      try {
        const membersResult = await wsClient.request("group.members", { groupId: dmRoom.id });
        const partner = membersResult.members.find((m) => m.id !== currentUser.id);
        if (!partner) return null;
        const summary = MAPPERS.userSummary(partner);
        store.set(`users.${partner.id}`, { ...store.get(`users.${partner.id}`), ...summary });
        return { ...summary, conversationId: dmRoom.id };
      } catch (err) {
        console.error(`Failed to resolve members for DM room ${dmRoom.id}:`, err);
        return null;
      }
    }))).filter(Boolean);
    store.set("resolvedDms", resolvedDms);

    const activeDest = store.get("activeDest");
    if (activeDest) {
      await loadConversationHistory(activeDest, activeConversationId());
    }
  } catch (err) {
    console.error("Failed to load initial data:", err);
  }
}

// Reload lists/history after an automatic reconnect (missed pushes while offline)
wsClient.onReconnect = () => {
  if (store.get("session.loggedIn")) {
    loadInitialData();
  }
};

// Mount the app template (reactive state lives in the store, context stays empty)
const appRoot = document.getElementById("app");
mount("app", {}, appRoot, store, { handlers });

// Debug handle (dev tools / tests): inspect reactive state without a bundler.
globalThis.__centrum = { store, wsClient };

// Bootstrap's own data-bs-dismiss handler is swallowed by the same show-transition
// guard hideModal works around: closing a modal within ~300ms of opening it does
// nothing. If a dismiss click didn't take effect, force-hide after the fade window.
document.addEventListener("click", (e) => {
  const dismiss = e.target instanceof Element && e.target.closest('[data-bs-dismiss="modal"]');
  if (!dismiss) return;
  const modal = dismiss.closest(".modal");
  if (!modal) return;
  setTimeout(() => {
    if (modal.classList.contains("show")) {
      bootstrap.Modal.getOrCreateInstance(modal).hide();
    }
  }, 450);
});

// Bootstrap sets aria-hidden while hiding a modal. Remove focus from controls
// inside it first so hidden content is never left as the active accessibility target.
document.addEventListener("hide.bs.modal", (event) => {
  const modal = event.target;
  const activeElement = document.activeElement;
  if (
    modal instanceof HTMLElement && activeElement instanceof HTMLElement &&
    modal.contains(activeElement)
  ) {
    activeElement.blur();
  }
});

document.addEventListener("shown.bs.modal", (e) => {
  if (e.target.id === "uploadAttachmentModal") {
    setupDragDropZone();
  }
});

function setupDragDropZone() {
  const dropZone = document.getElementById("dropZone");
  const modalFileInput = document.getElementById("modalFileInput");
  if (!dropZone) return;

  // This runs on every modal open; without the guard the drop listeners stack
  // and a single drop would upload the file once per previous open.
  if (dropZone.dataset.dndReady) return;
  dropZone.dataset.dndReady = "1";

  const preventDefaults = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  for (const eventName of ["dragenter", "dragover", "dragleave", "drop"]) {
    dropZone.addEventListener(eventName, preventDefaults);
  }
  for (const eventName of ["dragenter", "dragover"]) {
    dropZone.addEventListener(eventName, () => dropZone.classList.add("highlight"));
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove("highlight"));
  }

  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handlers.modalUploadFile(file);
  });

  if (modalFileInput) {
    modalFileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) handlers.modalUploadFile(file);
    };
  }
}

// ── WebSocket push handlers ──────────────────────────────────────
function destKeyForConversation(conversationId) {
  const chan = (store.get("channelList") || []).find((c) => c.id === conversationId);
  if (chan) return `channel_${chan.slug}`;
  const grp = (store.get("groupList") || []).find((g) => g.id === conversationId);
  if (grp) return `group_${grp.id}`;
  return `dm_${conversationId}`;
}

wsClient.addEventListener("message.new", async (data) => {
  const mapped = MAPPERS.message(data.message);
  const activeDestKey = store.get("activeDestKey");
  const currentUser = store.get("session.user");
  const isOwn = !!(currentUser && mapped.authorId === currentUser.id);

  // Refresh the author's profile (TTL-cached) so name-color/premium/avatar
  // changes from other users become visible — see refreshUserProfile.
  if (mapped.authorId && !isOwn) {
    await refreshUserProfile(mapped.authorId);
  }

  const msgDestKey = destKeyForConversation(mapped.conversationId);

  // A DM from a partner we haven't resolved yet (fresh conversation) — reload
  // the DM list so the Users tab shows them immediately.
  if (
    msgDestKey.startsWith("dm_") &&
    !(store.get("resolvedDms") || []).some((d) => d.conversationId === mapped.conversationId)
  ) {
    await loadInitialData();
  }

  appendRoomMessage(msgDestKey, mapped);

  if (activeDestKey === msgDestKey) {
    if (!isOwn) playBeep();
    wsClient.request("room.markRead", { conversationId: mapped.conversationId, messageId: mapped.id })
      .catch(() => {});
  } else if (!isOwn) {
    const countKey = `notifications.${msgDestKey}`;
    const prev = store.get(countKey) || 0;
    store.set(countKey, prev + 1);
    playBeep();
  }
});

wsClient.addEventListener("message.updated", (data) => {
  const mapped = MAPPERS.message(data.message);
  patchMessageById(mapped.id, mapped);
});

wsClient.addEventListener("reaction.updated", (data) => {
  const { messageId, reactions } = data;
  const mappedReactions = {};
  for (const r of reactions) {
    mappedReactions[r.emoji] = r.userIds || [];
  }

  // Reaction user ids may be unknown to us (e.g. someone we've never seen); make
  // sure the popover/badges can resolve them later.
  ensureUsersKnown(Object.values(mappedReactions).flat());

  patchMessageById(messageId, { reactions: mappedReactions });
});

wsClient.addEventListener("presence.updated", (data) => {
  const { userId, status } = data;
  const existing = store.get(`users.${userId}`);
  if (existing) {
    store.set(`users.${userId}`, { ...existing, status });
  }

  const resolvedDms = [...(store.get("resolvedDms") || [])];
  const dmIdx = resolvedDms.findIndex((d) => d.id === userId);
  if (dmIdx !== -1) {
    resolvedDms[dmIdx] = { ...resolvedDms[dmIdx], status };
    store.set("resolvedDms", resolvedDms);
  }
});

wsClient.addEventListener("typing.updated", (data) => {
  const { conversationId, userId, isTyping } = data;
  const currentUser = store.get("session.user");
  if (currentUser && userId === currentUser.id) return;

  if (activeConversationId() !== conversationId) return;

  if (isTyping) {
    const user = store.get(`users.${userId}`);
    const displayName = user ? user.displayName : "Someone";
    store.set("typingState", {
      active: true,
      avatarUrl: user?.avatarUrl || HELPERS.dicebearUrl(userId),
      text: `${displayName} is typing`,
    });
  } else {
    store.set("typingState.active", false);
  }
});

wsClient.addEventListener("unread.updated", (data) => {
  const { conversationId, count } = data;
  const destKey = destKeyForConversation(conversationId);
  // The active room is being read as messages arrive; don't resurrect its badge.
  if (destKey === store.get("activeDestKey")) return;
  store.set(`notifications.${destKey}`, count);
});

wsClient.addEventListener("notification.new", (data) => {
  const { notification } = data;
  const labels = {
    mention: "You were mentioned in a message.",
    dm: "New direct message received.",
    group_invite: "You were added to a group.",
    reaction: "Someone reacted to your message.",
  };
  ToastService.show(labels[notification.type] || "New notification.", "info");
  if (notification.type === "group_invite") {
    loadInitialData();
  }
});

wsClient.addEventListener("room.updated", () => {
  loadInitialData();
});

// ── Live search wiring ───────────────────────────────────────────
store.subscribe("searchState.userQuery", async (query) => {
  const trimmed = (query || "").trim();
  if (trimmed === "") {
    store.set("searchState.searchResults", []);
    return;
  }
  try {
    const res = await wsClient.request("search.users", { query: trimmed });
    store.set("searchState.searchResults", res.users.map(MAPPERS.userSummary));
  } catch (err) {
    console.error("User search failed:", err);
  }
});

store.subscribe("searchState.messageQuery", async (query) => {
  const trimmed = (query || "").trim();
  if (trimmed === "") {
    store.set("searchState.searchResultsMessages", null);
    return;
  }
  const conversationId = activeConversationId();
  if (!conversationId) return;
  try {
    const res = await wsClient.request("search.messages", { conversationId, query: trimmed });
    const messages = res.messages.map(MAPPERS.message);
    await ensureUsersKnown(messages.map((m) => m.authorId));
    store.set("searchState.searchResultsMessages", messages);
  } catch (err) {
    console.error("Message search failed:", err);
  }
});

// Init on reload
initApp();
