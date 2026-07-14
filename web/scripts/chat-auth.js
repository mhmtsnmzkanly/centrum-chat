import { store } from "./chat-store.js";
import { TOKEN_KEYS, parseJwt, parseStoredTokens } from "./shared-auth.js";

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

export const STORAGE = createStorageArea(window.localStorage, "local");
export const SESSION_STORAGE = createStorageArea(window.sessionStorage, "session");

export const TOKENS = {
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

// Exchange the stored refresh token for a fresh token pair.
export async function tryRefreshTokens() {
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

const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export async function ensureFreshAccessToken() {
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

let authLossHandler = null;
export function onAuthLoss(fn) {
  authLossHandler = fn;
}

const authCleanupCallbacks = [];
export function registerAuthCleanup(fn) {
  authCleanupCallbacks.push(fn);
}

export function clearAuthenticatedState(message = null, toastType = "info") {
  for (const cb of authCleanupCallbacks) {
    try {
      cb();
    } catch (err) {
      console.error("Auth cleanup callback error:", err);
    }
  }
  TOKENS.clear();
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
  store.set("searchHistory", []);
  store.set("focusMode", false);
  store.set("drafts", {});
  store.set("scrollFabCount", 0);
  store.set("chatForm.messageInput", "");


  if (authLossHandler) {
    authLossHandler(message, toastType);
  }
}
