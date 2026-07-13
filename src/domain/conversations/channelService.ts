import type { ConversationRepository } from "./conversationRepository.port.ts";
import { type ConversationSummary, toConversationSummary } from "./conversation.entity.ts";

/** docs/03-websocket-events.md "Module: Channels" — `channel.list`. No join/leave:
 * channels are public (architecture doc §13). */
export class ChannelService {
  constructor(private readonly rooms: ConversationRepository) {}

  listChannels(): ConversationSummary[] {
    return this.rooms.listChannels().map((conversation) =>
      toConversationSummary(conversation, null)
    );
  }
}
