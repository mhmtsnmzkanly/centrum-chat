export function normalizeEmailIdentity(value: string): string {
  return value.trim();
}

export function sanitizeDeviceLabel(value: string | null): string | null {
  if (value === null) return null;
  const stripped = [...value].map((char) => {
    const code = char.charCodeAt(0);
    return (code <= 0x1f || code === 0x7f) ? " " : char;
  }).join("").trim();
  return stripped.length > 0 ? stripped : null;
}

const MAX_USER_AGENT_LENGTH = 400;

/** Client-supplied User-Agent header: control characters stripped, length bounded.
 * Stored on the session row and shown only to the account owner (migration 0010). */
export function sanitizeUserAgent(value: string | null): string | null {
  const sanitized = sanitizeDeviceLabel(value);
  if (sanitized === null) return null;
  return sanitized.length > MAX_USER_AGENT_LENGTH
    ? sanitized.slice(0, MAX_USER_AGENT_LENGTH)
    : sanitized;
}
