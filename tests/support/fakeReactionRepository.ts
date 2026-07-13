import type { ReactionRepository } from "../../src/domain/reactions/reactionRepository.port.ts";
import type { ReactionSummary } from "../../src/domain/messages/message.entity.ts";

/** In-memory fake ReactionRepository — unit tests exercise domain services against
 * fake repos (docs/05-folder-structure.md tests/unit convention), not real SQLite. */
export class FakeReactionRepository implements ReactionRepository {
  private readonly byMessage = new Map<string, Set<string>>(); // messageId -> "userId:emoji"

  private key(userId: string, emoji: string): string {
    return `${userId}:${emoji}`;
  }

  exists(messageId: string, userId: string, emoji: string): boolean {
    return this.byMessage.get(messageId)?.has(this.key(userId, emoji)) ?? false;
  }

  add(messageId: string, userId: string, emoji: string): void {
    const set = this.byMessage.get(messageId) ?? new Set<string>();
    set.add(this.key(userId, emoji));
    this.byMessage.set(messageId, set);
  }

  remove(messageId: string, userId: string, emoji: string): void {
    this.byMessage.get(messageId)?.delete(this.key(userId, emoji));
  }

  listForMessage(messageId: string): ReactionSummary[] {
    const set = this.byMessage.get(messageId);
    if (!set) return [];
    const byEmoji = new Map<string, string[]>();
    for (const entry of set) {
      const [userId, emoji] = entry.split(":") as [string, string];
      const userIds = byEmoji.get(emoji) ?? [];
      userIds.push(userId);
      byEmoji.set(emoji, userIds);
    }
    return [...byEmoji.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
  }
}
