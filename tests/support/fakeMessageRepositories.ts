import type {
  MessageHistoryPage,
  MessageRepository,
  NewMessage,
} from "../../src/domain/messages/messageRepository.port.ts";
import type { Message } from "../../src/domain/messages/message.entity.ts";
import type { ConversationReadRepository } from "../../src/domain/conversations/conversationReadRepository.port.ts";

/** In-memory fake MessageRepository/ConversationReadRepository — unit tests exercise domain
 * services against fake repos (docs/05-folder-structure.md tests/unit convention). */
export class FakeMessageRepository implements MessageRepository {
  private readonly messagesById = new Map<string, Message>();
  private sequence = 0;

  create(message: NewMessage): Message {
    this.sequence += 1;
    const created: Message = {
      ...message,
      editedAt: null,
      deletedAt: null,
      createdAt: new Date(Date.now() + this.sequence).toISOString(),
    };
    this.messagesById.set(created.id, created);
    return created;
  }

  findById(id: string): Message | null {
    return this.messagesById.get(id) ?? null;
  }

  updateContent(id: string, content: string): Message {
    const existing = this.messagesById.get(id);
    if (!existing) throw new Error("message not found");
    const updated = { ...existing, content, editedAt: new Date().toISOString() };
    this.messagesById.set(id, updated);
    return updated;
  }

  softDelete(id: string): Message {
    const existing = this.messagesById.get(id);
    if (!existing) throw new Error("message not found");
    const updated = { ...existing, deletedAt: new Date().toISOString() };
    this.messagesById.set(id, updated);
    return updated;
  }

  history(conversationId: string, before: string | null, limit: number): MessageHistoryPage {
    const all = [...this.messagesById.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    const cutoffIndex = before ? all.findIndex((m) => m.id === before) : all.length;
    if (before && cutoffIndex === -1) return { messages: [], hasMore: false };

    const olderMessages = all.slice(0, cutoffIndex);
    const hasMore = olderMessages.length > limit;
    const page = olderMessages.slice(Math.max(0, olderMessages.length - limit));
    return { messages: page, hasMore };
  }

  search(conversationId: string, query: string, limit: number): Message[] {
    const lowerQuery = query.toLowerCase();
    return [...this.messagesById.values()]
      .filter((m) =>
        m.conversationId === conversationId && !m.deletedAt &&
        m.content.toLowerCase().includes(lowerQuery)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}

export class FakeConversationReadRepository implements ConversationReadRepository {
  private readonly lastReadByKey = new Map<string, string>();

  constructor(private readonly messages: FakeMessageRepository) {}

  private key(conversationId: string, userId: string): string {
    return `${conversationId}:${userId}`;
  }

  markRead(conversationId: string, userId: string, messageId: string): void {
    this.lastReadByKey.set(this.key(conversationId, userId), messageId);
  }

  getLastReadMessageId(conversationId: string, userId: string): string | null {
    return this.lastReadByKey.get(this.key(conversationId, userId)) ?? null;
  }

  countUnread(conversationId: string, userId: string): number {
    const lastReadId = this.getLastReadMessageId(conversationId, userId);
    const page = this.messages.history(conversationId, null, Number.MAX_SAFE_INTEGER);
    const nonDeleted = page.messages.filter((m) => !m.deletedAt);
    if (!lastReadId) return nonDeleted.length;

    const lastRead = this.messages.findById(lastReadId);
    if (!lastRead) return nonDeleted.length;
    return nonDeleted.filter((m) => m.createdAt > lastRead.createdAt).length;
  }
}
