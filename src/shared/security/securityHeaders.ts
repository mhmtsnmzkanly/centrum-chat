export const STRICT_TRANSPORT_SECURITY_POLICY = "max-age=15552000; includeSubDomains";

export interface SecurityHeaderPolicy {
  readonly enableHsts: boolean;
}

function mergeVary(existing: string | null, values: string[]): string {
  const merged = new Set(
    (existing ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  );
  for (const value of values) merged.add(value);
  return [...merged].join(", ");
}

function htmlContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "connect-src 'self' ws: wss: https://challenges.cloudflare.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https://api.dicebear.com",
    "script-src 'self' https://cdn.jsdelivr.net https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
  ].join("; ");
}

export function applySecurityHeaders(
  response: Response,
  policy: SecurityHeaderPolicy,
): Response {
  if (response.status === 101) return response;

  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("cross-origin-opener-policy", "same-origin");
  headers.set("cross-origin-resource-policy", "same-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  if (policy.enableHsts) {
    headers.set("strict-transport-security", STRICT_TRANSPORT_SECURITY_POLICY);
  } else {
    headers.delete("strict-transport-security");
  }
  headers.set(
    "vary",
    mergeVary(headers.get("vary"), [
      "Origin",
      "Access-Control-Request-Method",
      "Access-Control-Request-Headers",
    ]),
  );

  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("text/html")) {
    headers.set("content-security-policy", htmlContentSecurityPolicy());
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
