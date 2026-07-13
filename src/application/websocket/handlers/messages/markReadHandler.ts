import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { ConversationReadService } from "../../../../domain/conversations/conversationReadService.ts";
import type { ConnectionManager } from "../../../../transport/websocket/connectionManager.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import { outboundPush } from "../../../../protocol/envelopes.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";

/** docs/03-websocket-events.md "Module: Messages" — `room.markRead`. Also pushes the
 * caller their own recomputed `unread.updated` so an open client's badge clears
 * reactively without waiting for the next `message.new`. */
export class MarkReadHandler implements EventHandler {
  readonly event = "room.markRead";

  constructor(
    private readonly roomReadService: ConversationReadService,
    private readonly connectionManager: ConnectionManager,
    private readonly codec: ProtocolCodec,
  ) {}

  handle(ctx: HandlerContext, data: unknown): Record<string, never> {
    const body = asRecord(data, "room.markRead data");
    const conversationId = requireString(body, "conversationId");
    const messageId = requireString(body, "messageId");

    this.roomReadService.markRead(ctx.userId, conversationId, messageId);

    const count = this.roomReadService.countUnread(conversationId, ctx.userId);
    this.connectionManager.sendToUser(
      ctx.userId,
      this.codec.encode(outboundPush("unread.updated", { conversationId, count })),
    );

    return {};
  }
}
