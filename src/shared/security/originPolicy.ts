export function normalizeOrigin(rawOrigin: string, key = "origin"): string {
  let parsed: URL;
  try {
    parsed = new URL(rawOrigin);
  } catch {
    throw new Error(`${key} must be an absolute http(s) origin, got: ${rawOrigin}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${key} must use http or https, got: ${rawOrigin}`);
  }
  if (parsed.pathname !== "/" || parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new Error(`${key} must not include a path, query, or fragment, got: ${rawOrigin}`);
  }
  return parsed.origin;
}

export function parseAllowedOrigins(rawOrigins: string): string[] {
  if (rawOrigins.trim().length === 0) return [];
  return rawOrigins
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((origin) => normalizeOrigin(origin, "ALLOWED_ORIGINS entry"));
}

export function isSameOrigin(origin: string, requestUrl: string): boolean {
  return normalizeOrigin(origin) === new URL(requestUrl).origin;
}

export function isOriginAllowed(
  origin: string,
  requestUrl: string,
  allowedOrigins: readonly string[],
): boolean {
  return isSameOrigin(origin, requestUrl) || allowedOrigins.includes(normalizeOrigin(origin));
}
