import { store } from "./chat-store.js";
import {
  ensureFreshAccessToken,
  LOCAL_STORAGE,
  refreshTokens,
  registerSharedAuthCleanup,
  SESSION_STORAGE as SHARED_SESSION_STORAGE,
  TokenStorage,
} from "./shared-auth.js";

export const STORAGE = LOCAL_STORAGE;
export const SESSION_STORAGE = SHARED_SESSION_STORAGE;
export const TOKENS = TokenStorage;
export { ensureFreshAccessToken };

export async function tryRefreshTokens() {
  return (await refreshTokens()) !== null;
}

let authLossHandler = null;
export function onAuthLoss(fn) {
  authLossHandler = fn;
}

const authCleanupCallbacks = [];
export function registerAuthCleanup(fn) {
  authCleanupCallbacks.push(fn);
}

function resetChatState() {
  for (const callback of authCleanupCallbacks) {
    try {
      callback();
    } catch (error) {
      console.error("Auth cleanup callback error:", error);
    }
  }
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
}

registerSharedAuthCleanup(resetChatState);

export function clearAuthenticatedState(message = null, toastType = "info") {
  TOKENS.clear();
  if (authLossHandler) authLossHandler(message, toastType);
}
