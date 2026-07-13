export type ConversationMemberRole = "owner" | "moderator" | "member";

export interface ConversationMember {
  readonly conversationId: string;
  readonly userId: string;
  readonly role: ConversationMemberRole;
  readonly joinedAt: string;
}

/** Port implemented by `storage/repositories/sqliteConversationMembershipRepository.ts`. Membership
 * rows exist only for group/dm rooms plus optional sparse channel-moderator rows
 * (architecture doc §13) — never a precondition for ordinary channel access. */
export interface ConversationMembershipRepository {
  add(conversationId: string, userId: string, role: ConversationMemberRole): void;
  remove(conversationId: string, userId: string): void;
  findMember(conversationId: string, userId: string): ConversationMember | null;
  listMembers(conversationId: string): ConversationMember[];
  isMember(conversationId: string, userId: string): boolean;
  countMembers(conversationId: string): number;
  updateRole(conversationId: string, userId: string, role: ConversationMemberRole): void;
  /** Do these two users share any group room? Backs the `dmPrivacy: 'group_members'` policy. */
  sharesGroupWith(userIdA: string, userIdB: string): boolean;
}
