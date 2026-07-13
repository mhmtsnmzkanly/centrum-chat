import { isOriginAllowed } from "../../shared/security/originPolicy.ts";

const ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOW_HEADERS = "Authorization, Content-Type";

function addCorsHeaders(
  headers: Headers,
  request: Request,
  allowedOrigins: readonly string[],
): void {
  const origin = request.headers.get("origin");
  if (!origin || !isOriginAllowed(origin, request.url, allowedOrigins)) return;

  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", ALLOW_METHODS);
  headers.set("access-control-allow-headers", ALLOW_HEADERS);
  headers.set("access-control-max-age", "600");
}

export function buildPreflightResponse(
  request: Request,
  allowedOrigins: readonly string[],
): Response | null {
  if (request.method !== "OPTIONS") return null;

  const origin = request.headers.get("origin");
  const requestedMethod = request.headers.get("access-control-request-method");
  if (!origin || !requestedMethod) return null;
  if (!isOriginAllowed(origin, request.url, allowedOrigins)) {
    return new Response("Origin not allowed.", { status: 403 });
  }

  const headers = new Headers();
  addCorsHeaders(headers, request, allowedOrigins);
  return new Response(null, { status: 204, headers });
}

export function applyCorsHeaders(
  request: Request,
  response: Response,
  allowedOrigins: readonly string[],
): Response {
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  addCorsHeaders(headers, request, allowedOrigins);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
