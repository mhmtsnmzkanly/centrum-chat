import type { Message } from "./message.entity.ts";

export interface NewMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly authorId: string | null;
  readonly content: string;
  readonly replyToId: string | null;
  readonly clientOperationId?: string | null;
  readonly isSystem: boolean;
}

export interface MessageHistoryPage {
  readonly messages: Message[];
  readonly hasMore: boolean;
}

/** Port implemented by `storage/repositories/sqliteMessageRepository.ts`. */
export interface MessageRepository {
  create(message: NewMessage): Message;
  findById(id: string): Message | null;
  /** Looks up an upgraded client's retry-safe operation. Legacy messages use null. */
  findByClientOperationId(authorId: string, clientOperationId: string): Message | null;
  updateContent(id: string, content: string): Message;
  softDelete(id: string): Message;
  /** Descending-then-reversed page ending just before `before` (a message id cursor, or
   * null for the most recent page) — docs/03-websocket-events.md `message.history`.
   * Soft-deleted messages are included (with `deletedAt` set) so clients can render a
   * tombstone in place, not filtered out. */
  history(conversationId: string, before: string | null, limit: number): MessageHistoryPage;
  /** docs/03-websocket-events.md `search.messages` — substring match on `content`,
   * newest first, excluding soft-deleted messages (there's nothing to search in a
   * tombstone). */
  search(conversationId: string, query: string, limit: number): Message[];
}
