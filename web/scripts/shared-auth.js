export const TOKEN_KEYS = {
  persistent: "chat_session_tokens_persistent",
  session: "chat_session_tokens_session",
};

const SAFE_RETRY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ACCESS_TOKEN_MARGIN_MS = 60_000;
const APP_DESTINATIONS = new Set([
  "/",
  "/index.html",
  "/control-center",
  "/control-center/",
  "/control-center.html",
]);

let authEpoch = 0;
let refreshPromise = null;
const cleanupListeners = new Set();

browserGlobal()?.addEventListener?.("storage", (event) => {
  if (event.key === TOKEN_KEYS.persistent || event.key === TOKEN_KEYS.session) authEpoch += 1;
});

function browserGlobal() {
  return globalThis.window || globalThis;
}

function safeStorage(name) {
  const fallback = new Map();
  return {
    getItem(key) {
      try {
        return browserGlobal()[name]?.getItem(key) ?? fallback.get(key) ?? null;
      } catch {
        return fallback.get(key) ?? null;
      }
    },
    setItem(key, value) {
      try {
        browserGlobal()[name]?.setItem(key, value);
      } catch {
        fallback.set(key, value);
      }
    },
    removeItem(key) {
      try {
        browserGlobal()[name]?.removeItem(key);
      } catch {
        // The in-memory fallback is still cleared below.
      }
      fallback.delete(key);
    },
  };
}

export const LOCAL_STORAGE = safeStorage("localStorage");
export const SESSION_STORAGE = safeStorage("sessionStorage");

export function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64).split("").map(function (character) {
        return "%" + ("00" + character.charCodeAt(0).toString(16)).slice(-2);
      }).join(""),
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

export function parseStoredTokens(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed && typeof parsed.accessToken === "string" &&
      typeof parsed.refreshToken === "string"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function stored(area, key) {
  const tokens = parseStoredTokens(area.getItem(key));
  if (!tokens) area.removeItem(key);
  return tokens;
}

export const TokenStorage = {
  get() {
    const persistent = stored(LOCAL_STORAGE, TOKEN_KEYS.persistent);
    const session = stored(SESSION_STORAGE, TOKEN_KEYS.session);
    if (persistent && session) SESSION_STORAGE.removeItem(TOKEN_KEYS.session);
    return persistent || session;
  },
  set(tokens, rememberMe = this.isPersistent()) {
    if (
      typeof tokens?.accessToken !== "string" ||
      typeof tokens?.refreshToken !== "string"
    ) {
      throw new TypeError("A complete access/refresh token pair is required.");
    }
    authEpoch += 1;
    LOCAL_STORAGE.removeItem(TOKEN_KEYS.persistent);
    SESSION_STORAGE.removeItem(TOKEN_KEYS.session);
    const serialized = JSON.stringify(tokens);
    (rememberMe ? LOCAL_STORAGE : SESSION_STORAGE).setItem(
      rememberMe ? TOKEN_KEYS.persistent : TOKEN_KEYS.session,
      serialized,
    );
  },
  clear() {
    authEpoch += 1;
    LOCAL_STORAGE.removeItem(TOKEN_KEYS.persistent);
    SESSION_STORAGE.removeItem(TOKEN_KEYS.session);
    for (const listener of cleanupListeners) {
      try {
        listener();
      } catch (error) {
        console.error("Auth cleanup callback failed:", error);
      }
    }
  },
  isPersistent() {
    return stored(LOCAL_STORAGE, TOKEN_KEYS.persistent) !== null;
  },
};

export function getAuthEpoch() {
  return authEpoch;
}

export function registerSharedAuthCleanup(listener) {
  cleanupListeners.add(listener);
  return () => cleanupListeners.delete(listener);
}

export async function refreshTokens() {
  if (refreshPromise) return await refreshPromise;
  const current = TokenStorage.get();
  if (!current?.refreshToken) return null;
  const remembered = TokenStorage.isPersistent();
  const requestEpoch = authEpoch;
  const refreshToken = current.refreshToken;

  refreshPromise = (async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const envelope = await response.json().catch(() => null);
    if (!response.ok || !envelope?.success || !envelope.data?.accessToken) {
      if (requestEpoch === authEpoch) TokenStorage.clear();
      return null;
    }
    const stillCurrent = TokenStorage.get();
    if (
      requestEpoch !== authEpoch ||
      stillCurrent?.refreshToken !== refreshToken
    ) {
      return null;
    }
    const tokens = {
      accessToken: envelope.data.accessToken,
      refreshToken: envelope.data.refreshToken,
    };
    TokenStorage.set(tokens, remembered);
    return tokens;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function ensureFreshAccessToken() {
  const tokens = TokenStorage.get();
  if (!tokens?.accessToken) return null;
  const payload = parseJwt(tokens.accessToken);
  const expiresAt = typeof payload?.exp === "number" ? payload.exp * 1000 : 0;
  if (expiresAt - Date.now() > ACCESS_TOKEN_MARGIN_MS) return tokens.accessToken;
  return (await refreshTokens())?.accessToken ?? null;
}

export async function authenticatedFetch(path, options = {}, allowRetry = true) {
  const token = await ensureFreshAccessToken();
  if (!token) return new Response(null, { status: 401 });
  const requestContext = tokenContext(token);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, { ...options, headers });
  const currentContext = tokenContext(TokenStorage.get()?.accessToken);
  if (!requestContext || requestContext !== currentContext) {
    return new Response(null, { status: 401 });
  }
  const method = (options.method || "GET").toUpperCase();
  if (response.status !== 401 || !allowRetry || !SAFE_RETRY_METHODS.has(method)) {
    return response;
  }
  const refreshed = await refreshTokens();
  if (!refreshed?.accessToken) return response;
  headers.set("Authorization", `Bearer ${refreshed.accessToken}`);
  const retryContext = tokenContext(refreshed.accessToken);
  const retried = await fetch(path, { ...options, headers });
  return retryContext && retryContext === tokenContext(TokenStorage.get()?.accessToken)
    ? retried
    : new Response(null, { status: 401 });
}

function tokenContext(token) {
  const payload = typeof token === "string" ? parseJwt(token) : null;
  return typeof payload?.sub === "string" && typeof payload?.sid === "string"
    ? `${payload.sub}:${payload.sid}`
    : null;
}

export async function resolveAuthenticatedAccount() {
  const response = await authenticatedFetch("/api/auth/onboarding");
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope?.success) {
    if (response.status === 401) TokenStorage.clear();
    const error = new Error(envelope?.error?.message || "Unable to resolve the account session.");
    error.code = envelope?.error?.code || "UNAUTHORIZED";
    error.status = response.status;
    throw error;
  }
  return envelope.data;
}

export async function resolveControlCenterAccess() {
  const requestEpoch = authEpoch;
  const response = await authenticatedFetch("/api/control-center/me");
  const envelope = await response.json().catch(() => null);
  if (requestEpoch !== authEpoch) {
    throw new Error("The authenticated account changed while resolving Control Center access.");
  }
  if (response.status === 403) return { allowed: false, operator: null };
  if (!response.ok || !envelope?.success) {
    if (response.status === 401) TokenStorage.clear();
    const error = new Error(
      envelope?.error?.message || "Unable to resolve Control Center access.",
    );
    error.code = envelope?.error?.code || "UNAUTHORIZED";
    error.status = response.status;
    throw error;
  }
  const areas = envelope.data?.areas;
  return {
    allowed: !!(areas?.moderation || areas?.administration || areas?.owner),
    operator: envelope.data,
  };
}

export async function logoutBrowserSession() {
  const tokens = TokenStorage.get();
  try {
    if (tokens?.refreshToken) {
      await authenticatedFetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
    }
  } finally {
    TokenStorage.clear();
  }
}

function repeatedlyDecode(value) {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded;
}

export function resolveReturnTo(value, fallback = "/") {
  const safeFallback = APP_DESTINATIONS.has(fallback) && !fallback.startsWith("/auth")
    ? fallback
    : "/";
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return safeFallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return safeFallback;
  }
  const decoded = repeatedlyDecode(value);
  if (!decoded || decoded.includes("\\") || decoded.startsWith("//")) return safeFallback;
  try {
    const origin = browserGlobal().location?.origin || "http://localhost";
    const destination = new URL(value, origin);
    if (destination.origin !== origin || destination.username || destination.password) {
      return safeFallback;
    }
    const decodedPath = repeatedlyDecode(destination.pathname);
    if (!decodedPath || !APP_DESTINATIONS.has(decodedPath) || decodedPath.startsWith("/auth")) {
      return safeFallback;
    }
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return safeFallback;
  }
}

export function authPageUrl(returnTo) {
  const current = returnTo || `${browserGlobal().location?.pathname || "/"}${
    browserGlobal().location?.search || ""
  }${browserGlobal().location?.hash || ""}`;
  const safe = resolveReturnTo(current);
  return `/auth.html?returnTo=${encodeURIComponent(safe)}`;
}

export async function guardProtectedPage(returnTo) {
  try {
    const account = await resolveAuthenticatedAccount();
    if (!account.onboardingComplete) {
      browserGlobal().location.replace(authPageUrl(returnTo));
      return null;
    }
    return account;
  } catch {
    browserGlobal().location.replace(authPageUrl(returnTo));
    return null;
  }
}
