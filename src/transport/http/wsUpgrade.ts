import { attachSocket } from "../websocket/connection.ts";
import type { WebSocketHandlerRegistry } from "../../application/websocket/registry.ts";
import type { ConnectionManager } from "../websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../protocol/protocolCodec.ts";
import type { Logger } from "../../shared/logging/logger.ts";
import type { TokenService } from "../../domain/auth/tokenService.ts";
import { verifyAccessToken } from "../../application/middleware/authMiddleware.ts";
import { translateError } from "../../application/middleware/errorBoundary.ts";
import { errorResponse } from "../../application/http/responses.ts";
import { isOriginAllowed } from "../../shared/security/originPolicy.ts";
import { generateId } from "../../shared/id.ts";
import type { SanctionPolicy } from "../../domain/safety/safetyPolicy.ts";
import type { RuntimePolicy } from "../../domain/administration/runtimePolicy.ts";

export interface WsUpgradeDeps {
  readonly clientIp: string;
  readonly registry: WebSocketHandlerRegistry;
  readonly connectionManager: ConnectionManager;
  readonly codec: ProtocolCodec;
  readonly logger: Logger;
  readonly tokenService: TokenService;
  readonly allowedOrigins?: readonly string[];
  readonly maxMessageBytes?: number;
  readonly protocolErrorLimit?: number;
  readonly inboundRateLimiter?: {
    check(key: string): boolean;
  };
  readonly sanctionPolicy?: SanctionPolicy;
  readonly runtimePolicy?: RuntimePolicy;
}

/**
 * Handles the `GET /ws` upgrade. The access token travels as `?token=` (a browser
 * WebSocket client can't attach a custom Authorization header to the handshake) and is
 * verified before any upgrade happens: an invalid/missing token gets a plain HTTP error
 * response, never a 101. There is deliberately no in-band `authenticate` event — a
 * connection is either authenticated at the handshake or it never exists.
 */
export async function handleWsUpgrade(request: Request, deps: WsUpgradeDeps): Promise<Response> {
  const origin = request.headers.get("origin");
  if (
    origin !== null &&
    !isOriginAllowed(origin, request.url, deps.allowedOrigins ?? [])
  ) {
    deps.logger.warn("websocket upgrade rejected: origin not allowed", { origin });
    return new Response("Origin not allowed.", { status: 403 });
  }

  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    deps.logger.warn("websocket upgrade rejected: missing websocket upgrade header");
    return new Response("Expected a WebSocket upgrade request.", { status: 426 });
  }

  const token = new URL(request.url).searchParams.get("token");
  let userId: string;
  try {
    userId = (await verifyAccessToken(deps.tokenService, token)).userId;
    deps.sanctionPolicy?.requireApplicationAccess(userId);
    deps.runtimePolicy?.requireAccountAccess(userId);
  } catch (error) {
    deps.logger.warn("websocket upgrade rejected: access token verification failed");
    const { payload, httpStatus } = translateError(error, deps.logger);
    return errorResponse(deps.codec, payload, httpStatus);
  }

  const connectionId = generateId();
  const admission = deps.connectionManager.reserveConnection({
    connectionId,
    userId,
    clientIp: deps.clientIp,
  });
  if (!admission.ok) {
    deps.logger.warn("websocket upgrade rejected: connection limit reached", {
      userId,
      clientIp: deps.clientIp,
      reason: admission.reason,
    });
    return errorResponse(
      deps.codec,
      { code: "RATE_LIMITED", message: "WebSocket connection rejected." },
      429,
    );
  }

  try {
    const { socket, response } = Deno.upgradeWebSocket(request);
    deps.connectionManager.bindSocket(connectionId, socket);
    const attachOptions = {
      connectionId,
      socket,
      userId,
      registry: deps.registry,
      codec: deps.codec,
      connectionManager: deps.connectionManager,
      logger: deps.logger,
      ...(deps.maxMessageBytes === undefined ? {} : { maxMessageBytes: deps.maxMessageBytes }),
      ...(deps.protocolErrorLimit === undefined
        ? {}
        : { protocolErrorLimit: deps.protocolErrorLimit }),
      ...(deps.inboundRateLimiter === undefined
        ? {}
        : { inboundRateLimiter: deps.inboundRateLimiter }),
    };
    attachSocket(attachOptions);
    return response;
  } catch (error) {
    deps.connectionManager.releaseReservation(connectionId);
    throw error;
  }
}
