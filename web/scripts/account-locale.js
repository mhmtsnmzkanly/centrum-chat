import { authenticatedFetch, getAuthEpoch, TokenStorage } from "./shared-auth.js";
import { getLocale, hasStoredLocale, setLocale } from "./i18n.js";

async function preferenceRequest(options) {
  const epoch = getAuthEpoch();
  const response = await authenticatedFetch("/api/auth/preferences", options);
  const envelope = await response.json().catch(() => null);
  if (epoch !== getAuthEpoch()) throw new Error("The authenticated account changed.");
  if (!response.ok || !envelope?.success) {
    const error = new Error(envelope?.error?.message || "Unable to update language preference.");
    error.code = envelope?.error?.code || "PREFERENCE_ERROR";
    error.status = response.status;
    throw error;
  }
  return envelope.data.preferences;
}

export async function restoreAccountLocale() {
  if (!TokenStorage.get()) return null;
  const preferences = await preferenceRequest();
  if (preferences.locale) {
    setLocale(preferences.locale);
    return preferences.locale;
  }
  if (hasStoredLocale()) {
    await saveAccountLocale(getLocale());
    return getLocale();
  }
  return null;
}

export async function saveAccountLocale(locale) {
  if (!TokenStorage.get()) return null;
  const preferences = await preferenceRequest({
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  });
  return preferences.locale;
}
