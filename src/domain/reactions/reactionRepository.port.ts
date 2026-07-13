import type { ReactionSummary } from "../messages/message.entity.ts";

/** Port implemented by `storage/repositories/sqliteReactionRepository.ts`. */
export interface ReactionRepository {
  exists(messageId: string, userId: string, emoji: string): boolean;
  add(messageId: string, userId: string, emoji: string): void;
  remove(messageId: string, userId: string, emoji: string): void;
  /** Aggregated per emoji, e.g. `{ emoji: "👍", userIds: [...] }[]` — the shape
   * `Message['reactions']` expects (docs/03-websocket-events.md). */
  listForMessage(messageId: string): ReactionSummary[];
}
