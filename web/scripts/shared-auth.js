export const TOKEN_KEYS = {
  persistent: "chat_session_tokens_persistent",
  session: "chat_session_tokens_session",
};

export function parseJwt(token) {
  try {
    const base64Url = token.split(".")[1];
    if (!base64Url) return null;
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

export function parseStoredTokens(raw) {
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
