import type { RouteRegistry } from "../../application/http/routeRegistry.ts";
import { applyCorsHeaders, buildPreflightResponse } from "../../application/http/cors.ts";
import { errorResponse } from "../../application/http/responses.ts";
import { translateError } from "../../application/middleware/errorBoundary.ts";
import type { ProtocolCodec } from "../../protocol/protocolCodec.ts";
import type { Logger } from "../../shared/logging/logger.ts";
import { applySecurityHeaders } from "../../shared/security/securityHeaders.ts";

export interface HttpServerDeps {
  readonly host: string;
  readonly port: number;
  readonly registry: RouteRegistry;
  readonly codec: ProtocolCodec;
  readonly logger: Logger;
  readonly allowedOrigins?: readonly string[];
  readonly enableHsts?: boolean;
  /** Handles `GET /ws`; the WebSocket upgrade is a transport-layer concern, not an
   * ordinary JSON route, so it's recognized here before falling through to RouteRegistry. */
  readonly wsUpgrade?: (request: Request, clientIp: string) => Response | Promise<Response>;
}

/** Deno.serve wrapper. No business logic, no SQL — every non-WS request is handed to
 * RouteRegistry. */
export function startHttpServer(deps: HttpServerDeps): Deno.HttpServer {
  const {
    host,
    port,
    registry,
    codec,
    logger,
    allowedOrigins = [],
    wsUpgrade,
    enableHsts = false,
  } = deps;
  return Deno.serve({ hostname: host, port }, async (request, info) => {
    const startedAt = Date.now();
    const url = new URL(request.url);
    const clientIp = info.remoteAddr.hostname;
    const preflightResponse = buildPreflightResponse(request, allowedOrigins);
    if (preflightResponse) {
      return finalizeResponse(
        request,
        preflightResponse,
        startedAt,
        logger,
        clientIp,
        url.pathname,
        allowedOrigins,
        enableHsts,
      );
    }

    if (wsUpgrade && url.pathname === "/ws") {
      const response = await wsUpgrade(request, clientIp);
      return finalizeResponse(
        request,
        response,
        startedAt,
        logger,
        clientIp,
        url.pathname,
        allowedOrigins,
        enableHsts,
      );
    }

    // Request-scoped context (architecture doc §5 rate limiting note applies the same
    // idea to logging): an "unexpected error" line is enough on its own to find the
    // failing request, without cross-referencing other log lines.
    const requestLogger = logger.child("http-request", {
      method: request.method,
      path: url.pathname,
      clientIp,
    });
    try {
      const response = await registry.dispatch(request, clientIp);
      if (response) {
        return finalizeResponse(
          request,
          response,
          startedAt,
          logger,
          clientIp,
          url.pathname,
          allowedOrigins,
          enableHsts,
        );
      }
      return finalizeResponse(
        request,
        errorResponse(codec, { code: "NOT_FOUND", message: "No such route." }, 404),
        startedAt,
        logger,
        clientIp,
        url.pathname,
        allowedOrigins,
        enableHsts,
      );
    } catch (error) {
      const { payload, httpStatus } = translateError(error, requestLogger);
      return finalizeResponse(
        request,
        errorResponse(codec, payload, httpStatus),
        startedAt,
        logger,
        clientIp,
        url.pathname,
        allowedOrigins,
        enableHsts,
      );
    }
  });
}

function finalizeResponse(
  request: Request,
  response: Response,
  startedAt: number,
  logger: Logger,
  clientIp: string,
  path: string,
  allowedOrigins: readonly string[],
  enableHsts: boolean,
): Response {
  const secured = applySecurityHeaders(
    applyCorsHeaders(request, response, allowedOrigins),
    { enableHsts },
  );
  logger.info("http request completed", {
    method: request.method,
    path,
    clientIp,
    status: secured.status,
    durationMs: Date.now() - startedAt,
  });
  return secured;
}
