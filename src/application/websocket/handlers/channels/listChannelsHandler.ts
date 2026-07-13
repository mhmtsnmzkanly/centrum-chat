import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { ChannelService } from "../../../../domain/conversations/channelService.ts";
import type { ConversationSummary } from "../../../../domain/conversations/conversation.entity.ts";

/** docs/03-websocket-events.md "Module: Channels" — `channel.list`. Channels are public;
 * there is no `channel.join`/`channel.leave` handler (architecture doc §13). */
export class ListChannelsHandler implements EventHandler {
  readonly event = "channel.list";

  constructor(private readonly channelService: ChannelService) {}

  handle(_ctx: HandlerContext, _data: unknown): { channels: ConversationSummary[] } {
    return { channels: this.channelService.listChannels() };
  }
}
