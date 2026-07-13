export interface DirectConversationPairRepository {
  findConversationIdByUsers(userAId: string, userBId: string): string | null;
  createPair(conversationId: string, userAId: string, userBId: string): void;
}
