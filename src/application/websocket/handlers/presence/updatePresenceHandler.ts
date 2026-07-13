import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { PresenceService } from "../../../../domain/presence/presenceService.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import { outboundPush } from "../../../../protocol/envelopes.ts";
import { asRecord, requireEnum } from "../../../../shared/validation/validator.ts";

const STATUSES = ["online", "idle", "dnd", "offline"] as const;

/** docs/03-websocket-events.md "Module: Presence" — explicit user-driven status change,
 * broadcast to every connected client. Channels are open to every authenticated user, so
 * in the current room model "every room the user shares with others" reduces to
 * "everyone"; this is revisited if a future phase adds private-room-scoped presence. */
export class UpdatePresenceHandler implements EventHandler {
  readonly event = "presence.update";

  constructor(
    private readonly presenceService: PresenceService,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
  ) {}

  handle(ctx: HandlerContext, data: unknown): Record<string, never> {
    const body = asRecord(data, "presence.update data");
    const status = requireEnum(body, "status", STATUSES);

    const transition = this.presenceService.updateStatus(ctx.userId, status);
    this.connectionManager.broadcastToAll(
      this.codec.encode(outboundPush("presence.updated", transition)),
    );
    return {};
  }
}
