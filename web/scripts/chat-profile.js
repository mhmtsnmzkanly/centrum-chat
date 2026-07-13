import { store, coverStyleFor } from "./chat-store.js";
import { wsClient } from "./chat-socket.js";
import { MAPPERS } from "./chat-messages.js";

// Replace the session user with a freshly mapped wire profile, remembering the
// last status the server confirmed.
export function applySessionProfile(profileWire) {
  const profile = MAPPERS.profile(profileWire);
  store.set("session.user", { ...profile, lastSyncedStatus: profile.status });
  return profile;
}

export function seedPreferencesForm(prefs) {
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

const inflightProfileFetches = new Map();

export function refreshUserProfile(userId) {
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
