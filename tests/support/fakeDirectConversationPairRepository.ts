import type { DirectConversationPairRepository } from "../../src/domain/conversations/directConversationPairRepository.port.ts";
import { canonicalizeDirectConversationPair } from "../../src/domain/conversations/directConversationPair.ts";

function pairKey(userAId: string, userBId: string): string {
  const { userLowId, userHighId } = canonicalizeDirectConversationPair(userAId, userBId);
  return `${userLowId}:${userHighId}`;
}

export class FakeDirectConversationPairRepository implements DirectConversationPairRepository {
  private readonly conversationIdByPair = new Map<string, string>();
  private failNextCreateError: Error | null = null;

  findConversationIdByUsers(userAId: string, userBId: string): string | null {
    return this.conversationIdByPair.get(pairKey(userAId, userBId)) ?? null;
  }

  createPair(conversationId: string, userAId: string, userBId: string): void {
    if (this.failNextCreateError) {
      const error = this.failNextCreateError;
      this.failNextCreateError = null;
      throw error;
    }

    const key = pairKey(userAId, userBId);
    if (this.conversationIdByPair.has(key)) {
      throw new Error(
        "UNIQUE constraint failed: direct_conversation_pairs.user_low_id, direct_conversation_pairs.user_high_id",
      );
    }
    this.conversationIdByPair.set(key, conversationId);
  }

  failNextCreate(error: Error): void {
    this.failNextCreateError = error;
  }
}
