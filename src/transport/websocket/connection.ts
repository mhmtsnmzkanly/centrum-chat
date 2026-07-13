import type { WebSocketHandlerRegistry } from "../../application/websocket/registry.ts";
import type { HandlerContext } from "../../application/websocket/eventHandler.ts";
import type { ProtocolCodec } from "../../protocol/protocolCodec.ts";
import { isInboundEnvelope, protocolErrorPush } from "../../protocol/envelopes.ts";
import type { ConnectionManager } from "./connectionManager.ts";
import type { Logger } from "../../shared/logging/logger.ts";

interface CheckableRateLimiter {
  check(key: string): boolean;
}

export interface AttachSocketOptions {
  readonly connectionId: string;
  readonly socket: WebSocket;
  readonly userId: string;
  readonly registry: WebSocketHandlerRegistry;
  readonly codec: ProtocolCodec;
  readonly connectionManager: ConnectionManager;
  readonly logger: Logger;
  readonly maxMessageBytes?: number;
  readonly protocolErrorLimit?: number;
  readonly inboundRateLimiter?: CheckableRateLimiter;
}

/** Registers the transport-layer message loop for one socket: decode -> validate
 * envelope shape -> registry.dispatch -> encode -> send. No business logic lives here;
 * everything past envelope-shape validation is the application layer's job. Presence
 * transitions (architecture doc, docs/03-websocket-events.md "Connection lifecycle") are
 * counted here (first/last concurrent connection for a user) since only the transport
 * layer tracks connection multiplicity; the actual state change is PresenceService's call. */
export function attachSocket(options: AttachSocketOptions): string {
  const { socket, userId, registry, codec, connectionManager, logger } = options;
  const { connectionId } = options;
  const connLogger = logger.child("ws-connection", { connectionId, userId });
  const maxMessageBytes = options.maxMessageBytes ?? 65_536;
  const protocolErrorLimit = options.protocolErrorLimit ?? 3;
  let protocolErrorCount = 0;

  socket.addEventListener("open", () => {
    connectionManager.markOpen(connectionId);
  });

  socket.addEventListener("message", (event) => {
    void handleMessage(event).catch((error) => {
      connLogger.error("unhandled error while processing message", {
        error,
      });
    });
  });

  socket.addEventListener("close", () => {
    connectionManager.handleSocketClosed(connectionId);
  });

  socket.addEventListener("error", (event) => {
    connLogger.warn("socket error", { event: String(event) });
  });

  async function handleMessage(event: MessageEvent): Promise<void> {
    if (typeof event.data !== "string") {
      protocolViolation("Only text frames are supported in protocol v1.0.", 1003);
      return;
    }

    const payloadBytes = new TextEncoder().encode(event.data).length;
    if (payloadBytes > maxMessageBytes) {
      protocolViolation(
        `WebSocket message exceeds the maximum allowed size of ${maxMessageBytes} bytes.`,
        1009,
      );
      return;
    }

    let decoded: unknown;
    try {
      decoded = codec.decode(event.data);
    } catch {
      protocolViolation("Malformed JSON payload.");
      return;
    }

    if (!isInboundEnvelope(decoded)) {
      protocolViolation(
        "Envelope must be an object with string `id`, string `event`, and `data`.",
      );
      return;
    }

    connectionManager.recordActivity(connectionId);

    if (
      options.inboundRateLimiter &&
      !options.inboundRateLimiter.check(`ws.inbound:${connectionId}`)
    ) {
      connectionManager.sendToConnection(
        connectionId,
        codec.encode({
          id: decoded.id,
          event: decoded.event,
          success: false,
          error: { code: "RATE_LIMITED", message: "Too many WebSocket messages. Slow down." },
        }),
      );
      return;
    }

    const ctx: HandlerContext = { userId, connectionId };
    const response = await registry.dispatch(ctx, decoded, connLogger);
    connectionManager.sendToConnection(connectionId, codec.encode(response));
  }

  function protocolViolation(message: string, closeCode = 1008): void {
    protocolErrorCount += 1;
    connectionManager.sendToConnection(
      connectionId,
      codec.encode(protocolErrorPush({ code: "VALIDATION_ERROR", message })),
    );
    if (protocolErrorCount >= protocolErrorLimit) {
      connLogger.warn("closing websocket after repeated protocol violations", {
        protocolErrorCount,
        closeCode,
      });
      connectionManager.closeConnection(connectionId, {
        code: closeCode,
        reason: "Connection closed.",
        source: closeCode === 1009 ? "payload_too_large" : "protocol_violation",
      });
    }
  }

  return connectionId;
}
