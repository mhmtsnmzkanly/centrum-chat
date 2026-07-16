import * as Errors from "./control-center-errors.js";
import {
  authenticatedFetch,
  authPageUrl,
  TokenStorage,
} from "./shared-auth.js";
import { localizeError } from "./i18n.js";

export { TokenStorage };

export function handleAuthLoss() {
  TokenStorage.clear();
  globalThis.controlCenterStore?.clearSensitiveState();
  const location = (globalThis.window || globalThis).location;
  if (location) location.replace(authPageUrl("/control-center"));
}

function serverError(response, envelope) {
  const code = envelope?.error?.code;
  const message = localizeError(
    code,
    envelope?.error?.message || `Request failed (${response.status}).`,
  );
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
  error.serverCode = code || error.code;
  error.status = response.status;
  return error;
}

async function apiFetch(path, options = {}, retry = true) {
  let response;
  try {
    response = await authenticatedFetch(path, options, retry);
  } catch {
    throw new Errors.NetworkError(localizeError("NETWORK_ERROR"));
  }
  if (response.status === 401) {
    handleAuthLoss();
    throw new Errors.UnauthorizedError(localizeError("UNAUTHORIZED"));
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
