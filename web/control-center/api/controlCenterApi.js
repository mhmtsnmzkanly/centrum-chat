import * as Errors from "./errors.js";

// Fixtures are intentionally disconnected from the production module graph.
export const USE_DEVELOPMENT_FIXTURES = false;

const TOKEN_KEYS = Object.freeze({
  persistent: "chat_session_tokens_persistent",
  session: "chat_session_tokens_session",
});
const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
let refreshPromise = null;

const storage = {
  get local() {
    return (globalThis.window || globalThis).localStorage;
  },
  get session() {
    return (globalThis.window || globalThis).sessionStorage;
  },
};

function readStored(store, key) {
  try {
    const value = store.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (
      typeof parsed?.accessToken !== "string" ||
      typeof parsed?.refreshToken !== "string"
    ) {
      store.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    store.removeItem(key);
    return null;
  }
}

function parseJwt(token) {
  try {
    const encoded = token.split(".")[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized));
  } catch {
    return null;
  }
}

export const TokenStorage = {
  get() {
    const persistent = readStored(storage.local, TOKEN_KEYS.persistent);
    const session = readStored(storage.session, TOKEN_KEYS.session);
    if (persistent) {
      if (session) storage.session.removeItem(TOKEN_KEYS.session);
      return persistent;
    }
    return session;
  },
  set(tokens, rememberMe = false) {
    this.clear();
    const serialized = JSON.stringify(tokens);
    (rememberMe ? storage.local : storage.session).setItem(
      rememberMe ? TOKEN_KEYS.persistent : TOKEN_KEYS.session,
      serialized,
    );
  },
  clear() {
    storage.local.removeItem(TOKEN_KEYS.persistent);
    storage.session.removeItem(TOKEN_KEYS.session);
  },
  isPersistent() {
    return readStored(storage.local, TOKEN_KEYS.persistent) !== null;
  },
};

export function handleAuthLoss() {
  TokenStorage.clear();
  globalThis.controlCenterStore?.clearSensitiveState();
  const location = (globalThis.window || globalThis).location;
  if (location) location.href = "/";
}

async function refreshTokens() {
  if (refreshPromise) return await refreshPromise;
  const current = TokenStorage.get();
  if (!current?.refreshToken) throw new Errors.UnauthorizedError();
  const persistent = TokenStorage.isPersistent();
  refreshPromise = (async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    const envelope = await response.json().catch(() => null);
    if (!response.ok || !envelope?.success || !envelope.data?.accessToken) {
      throw new Errors.UnauthorizedError();
    }
    const tokens = {
      accessToken: envelope.data.accessToken,
      refreshToken: envelope.data.refreshToken,
    };
    TokenStorage.set(tokens, persistent);
    return tokens.accessToken;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function getAccessToken() {
  const tokens = TokenStorage.get();
  if (!tokens?.accessToken) throw new Errors.UnauthorizedError();
  const payload = parseJwt(tokens.accessToken);
  if (!payload || typeof payload.exp !== "number") {
    throw new Errors.UnauthorizedError();
  }
  if (payload.exp - Math.floor(Date.now() / 1000) < 10) {
    return await refreshTokens();
  }
  return tokens.accessToken;
}

function serverError(response, envelope) {
  const message = envelope?.error?.message ||
    `Request failed (${response.status}).`;
  const details = envelope?.error?.details;
  let error;
  if (response.status === 400) {
    error = new Errors.ValidationError(message, details);
  } else if (response.status === 403) {
    error = new Errors.ForbiddenError(message);
  } else if (response.status === 404) error = new Errors.NotFoundError(message);
  else if (response.status === 409) error = new Errors.ConflictError(message);
  else if (response.status === 429) {
    error = new Errors.RateLimitError(
      message,
      response.headers.get("Retry-After"),
    );
  } else error = new Errors.ServerError(message);
  error.serverCode = envelope?.error?.code || error.code;
  error.status = response.status;
  return error;
}

async function apiFetch(path, options = {}, retry = true) {
  const method = (options.method || "GET").toUpperCase();
  let token;
  try {
    token = await getAccessToken();
  } catch (error) {
    handleAuthLoss();
    throw error;
  }
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new Errors.NetworkError();
  }
  if (response.status === 401) {
    if (retry && SAFE_RETRY_METHODS.has(method)) {
      try {
        await refreshTokens();
        return await apiFetch(path, options, false);
      } catch {
        // Authentication loss is handled below.
      }
    }
    handleAuthLoss();
    throw new Errors.UnauthorizedError();
  }
  const envelope = await response.json().catch(() => null);
  if (!response.ok) {
    const error = serverError(response, envelope);
    if (response.status === 403 && options.handleForbidden !== false) {
      globalThis.controlCenterStore?.handleForbidden();
    }
    throw error;
  }
  if (!envelope?.success) {
    throw new Errors.ServerError("Malformed server response.");
  }
  return envelope.data;
}

function query(path, input, names) {
  const params = new URLSearchParams();
  for (const name of names) {
    const value = input?.[name];
    if (value !== undefined && value !== null && value !== "") {
      params.set(name, String(value));
    }
  }
  const encoded = params.toString();
  return encoded ? `${path}?${encoded}` : path;
}
const json = (method, body, extra = {}) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  ...extra,
});
const id = encodeURIComponent;

export const ControlCenterApi = {
  getOperator() {
    return apiFetch("/api/control-center/me", { handleForbidden: false });
  },
  listReports(input = {}) {
    return apiFetch(query("/api/moderation/reports", input, [
      "status",
      "targetType",
      "assignedToMe",
      "cursor",
      "limit",
    ]));
  },
  getReport(reportId) {
    return apiFetch(`/api/moderation/reports/${id(reportId)}`);
  },
  getReportContext(reportId, before = 10, after = 10) {
    return apiFetch(query(`/api/moderation/reports/${id(reportId)}/context`, {
      before,
      after,
    }, ["before", "after"]));
  },
  assignReport(reportId, expectedAssigneeId, moderatorId = null) {
    return apiFetch(
      `/api/moderation/reports/${id(reportId)}/assign`,
      json("POST", {
        expectedAssigneeId,
        ...(moderatorId ? { moderatorId } : {}),
      }),
    );
  },
  transitionReport(reportId, expectedStatus, nextStatus) {
    return apiFetch(
      `/api/moderation/reports/${id(reportId)}/status`,
      json("POST", {
        expectedStatus,
        nextStatus,
      }),
    );
  },
  listUserSanctions(userId, input = {}) {
    return apiFetch(
      query(`/api/moderation/users/${id(userId)}/sanctions`, input, [
        "activeOnly",
        "cursor",
        "limit",
      ]),
    );
  },
  applySanction(userId, sanction) {
    return apiFetch(
      `/api/moderation/users/${id(userId)}/sanctions`,
      json("POST", sanction),
    );
  },
  revokeSanction(sanctionId, reason) {
    return apiFetch(
      `/api/moderation/sanctions/${id(sanctionId)}/revoke`,
      json("POST", reason ? { reason } : {}),
    );
  },
  listAuditEvents(input = {}) {
    return apiFetch(query("/api/admin/audit-events", input, [
      "actionCode",
      "actorUserId",
      "targetType",
      "targetId",
      "cursor",
      "limit",
    ]));
  },
  listUsers(input = {}) {
    return apiFetch(query("/api/admin/users", input, [
      "search",
      "role",
      "verified",
      "suspended",
      "disabled",
      "cursor",
      "limit",
    ]));
  },
  getUser(userId) {
    return apiFetch(`/api/admin/users/${id(userId)}`);
  },
  updateUser(userId, expectedVersion, patch) {
    return apiFetch(
      `/api/admin/users/${id(userId)}`,
      json("PATCH", { expectedVersion, ...patch }),
    );
  },
  revokeUserSessions(userId) {
    return apiFetch(`/api/admin/users/${id(userId)}/revoke-sessions`, {
      method: "POST",
    });
  },
  forcePasswordReset(userId) {
    return apiFetch(`/api/admin/users/${id(userId)}/force-password-reset`, {
      method: "POST",
    });
  },
  resetUserAvatar(userId) {
    return apiFetch(`/api/admin/users/${id(userId)}/reset-avatar`, {
      method: "POST",
    });
  },
  resetUserCover(userId) {
    return apiFetch(`/api/admin/users/${id(userId)}/reset-cover`, {
      method: "POST",
    });
  },
  assignRole(userId, expectedRole, role) {
    return apiFetch(
      `/api/admin/users/${id(userId)}/roles`,
      json("POST", { expectedRole, role }),
    );
  },
  revokeRole(userId, role, expectedRole) {
    return apiFetch(
      `/api/admin/users/${id(userId)}/roles/${id(role)}`,
      json("DELETE", { expectedRole }),
    );
  },
  transferOwnership(
    targetUserId,
    expectedCurrentOwnerRole,
    expectedTargetRole,
  ) {
    return apiFetch(
      "/api/owner/transfer",
      json("POST", {
        targetUserId,
        expectedCurrentOwnerRole,
        expectedTargetRole,
      }),
    );
  },
  listChannels(input = {}) {
    return apiFetch(
      query("/api/admin/channels", input, ["state", "cursor", "limit"]),
    );
  },
  createChannel(channel) {
    return apiFetch("/api/admin/channels", json("POST", channel));
  },
  updateChannel(channelId, expectedVersion, patch) {
    return apiFetch(
      `/api/admin/channels/${id(channelId)}`,
      json("PATCH", { expectedVersion, ...patch }),
    );
  },
  archiveChannel(channelId, expectedVersion) {
    return apiFetch(
      `/api/admin/channels/${id(channelId)}/archive`,
      json("POST", { expectedVersion }),
    );
  },
  restoreChannel(channelId, expectedVersion) {
    return apiFetch(
      `/api/admin/channels/${id(channelId)}/restore`,
      json("POST", { expectedVersion }),
    );
  },
  getSettings() {
    return apiFetch("/api/admin/settings");
  },
  updateSetting(key, expectedVersion, value) {
    return apiFetch(
      "/api/admin/settings",
      json("PATCH", { key, expectedVersion, value }),
    );
  },
};

export const __test = { apiFetch, parseJwt, TOKEN_KEYS };
