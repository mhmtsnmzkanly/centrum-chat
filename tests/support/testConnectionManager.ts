import { outboundPush } from "../../src/protocol/envelopes.ts";
import type { ProtocolCodec } from "../../src/protocol/protocolCodec.ts";
import type { PresenceService } from "../../src/domain/presence/presenceService.ts";
import {
  ConnectionManager,
  type ConnectionManagerOptions,
} from "../../src/transport/websocket/connectionManager.ts";

export function createPresenceAwareConnectionManager(
  presenceService: PresenceService,
  codec: ProtocolCodec,
  options: ConnectionManagerOptions = {},
): ConnectionManager {
  const manager = new ConnectionManager({
    ...options,
    hooks: {
      ...options.hooks,
      onConnectionOpened: (connection, isFirstOpenConnectionForUser) => {
        options.hooks?.onConnectionOpened?.(connection, isFirstOpenConnectionForUser);
        const transition = presenceService.handleConnect(
          connection.userId,
          isFirstOpenConnectionForUser,
        );
        if (!transition) return;
        manager.broadcastToAll(codec.encode(outboundPush("presence.updated", transition)));
      },
      onConnectionClosed: (connection, details) => {
        options.hooks?.onConnectionClosed?.(connection, details);
        if (!details.wasOpen) return;
        const transition = presenceService.handleDisconnect(
          connection.userId,
          details.isLastOpenConnectionForUser,
        );
        if (!transition) return;
        manager.broadcastToAll(codec.encode(outboundPush("presence.updated", transition)));
      },
    },
  });
  return manager;
}
