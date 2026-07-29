const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

export function escapeMailHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function requireSafeMailUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Mail action URL must be an absolute HTTP(S) URL.");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new Error("Mail action URL must use HTTP or HTTPS.");
  }

  return url.toString();
}
