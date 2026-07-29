/** Port implemented by `storage/repositories/sqliteConversationReadRepository.ts`. Decoupled from
 * `conversation_memberships` (docs/02-database-schema.md) so it works for channels too, which have
 * no per-user membership rows. */
export interface ConversationReadRepository {
  /** Atomically advances a read marker only when `messageId` belongs to the supplied
   * conversation. Soft-deleted messages remain valid markers: history retains their
   * tombstones and unread counts already exclude them. */
  markRead(conversationId: string, userId: string, messageId: string): boolean;
  getLastReadMessageId(conversationId: string, userId: string): string | null;
  /** docs/02-database-schema.md "Unread counters": messages newer than the last-read
   * message, excluding soft-deleted ones; if the user has never marked this room read,
   * every non-deleted message in it counts as unread. */
  countUnread(conversationId: string, userId: string): number;
}
