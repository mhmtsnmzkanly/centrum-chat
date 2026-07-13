import type {
  ConversationRepository,
  NewConversation,
} from "../../src/domain/conversations/conversationRepository.port.ts";
import type { Conversation } from "../../src/domain/conversations/conversation.entity.ts";
import type {
  ConversationMember,
  ConversationMemberRole,
  ConversationMembershipRepository,
} from "../../src/domain/conversations/conversationMembershipRepository.port.ts";

/** In-memory fake ConversationRepository/ConversationMembershipRepository — unit tests exercise domain
 * services against fake repos (docs/05-folder-structure.md tests/unit convention). */
export class FakeConversationRepository implements ConversationRepository {
  private readonly conversationsById = new Map<string, Conversation>();

  constructor(private readonly members: FakeConversationMemberRepository) {}

  create(room: NewConversation): Conversation {
    const created: Conversation = {
      id: room.id,
      type: room.type,
      slug: room.slug ?? null,
      name: room.name ?? null,
      topic: room.topic ?? null,
      ownerId: room.ownerId ?? null,
      isPublic: room.isPublic,
      description: room.topic ?? "",
      sortOrder: 0,
      lifecycleState: "active",
      adminVersion: 1,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.conversationsById.set(created.id, created);
    this.members.registerConversationType(created.id, created.type);
    return created;
  }

  findById(id: string): Conversation | null {
    return this.conversationsById.get(id) ?? null;
  }

  findBySlug(slug: string): Conversation | null {
    return [...this.conversationsById.values()].find((r) =>
      r.type === "channel" && r.slug === slug
    ) ??
      null;
  }

  listChannels(): Conversation[] {
    return [...this.conversationsById.values()].filter((r) => r.type === "channel");
  }

  listGroupsForUser(userId: string): Conversation[] {
    return [...this.conversationsById.values()].filter((r) =>
      r.type === "group" && this.members.isMember(r.id, userId)
    );
  }

  listDmsForUser(userId: string): Conversation[] {
    return [...this.conversationsById.values()].filter((r) =>
      r.type === "dm" && this.members.isMember(r.id, userId)
    );
  }

  findDmForPair(userIdA: string, userIdB: string): Conversation | null {
    return [...this.conversationsById.values()].find((r) =>
      r.type === "dm" && this.members.isMember(r.id, userIdA) &&
      this.members.isMember(r.id, userIdB)
    ) ?? null;
  }

  delete(conversationId: string): void {
    this.conversationsById.delete(conversationId);
  }

  transferOwnership(conversationId: string, newOwnerId: string): void {
    const conversation = this.conversationsById.get(conversationId);
    if (conversation) {
      this.conversationsById.set(conversationId, { ...conversation, ownerId: newOwnerId });
    }
  }
}

export class FakeConversationMemberRepository implements ConversationMembershipRepository {
  private readonly membersByRoom = new Map<string, Map<string, ConversationMember>>();
  /** Test-only: lets `sharesGroupWith` restrict to actual group conversations, mirroring the
   * real SQL join against `conversations.type = 'group'`. Populated by FakeConversationRepository.create. */
  private readonly conversationTypeById = new Map<string, string>();

  registerConversationType(conversationId: string, type: string): void {
    this.conversationTypeById.set(conversationId, type);
  }

  add(conversationId: string, userId: string, role: ConversationMemberRole): void {
    const roomMembers = this.membersByRoom.get(conversationId) ??
      new Map<string, ConversationMember>();
    roomMembers.set(userId, { conversationId, userId, role, joinedAt: new Date().toISOString() });
    this.membersByRoom.set(conversationId, roomMembers);
  }

  remove(conversationId: string, userId: string): void {
    this.membersByRoom.get(conversationId)?.delete(userId);
  }

  findMember(conversationId: string, userId: string): ConversationMember | null {
    return this.membersByRoom.get(conversationId)?.get(userId) ?? null;
  }

  listMembers(conversationId: string): ConversationMember[] {
    return [...(this.membersByRoom.get(conversationId)?.values() ?? [])];
  }

  isMember(conversationId: string, userId: string): boolean {
    return this.findMember(conversationId, userId) !== null;
  }

  countMembers(conversationId: string): number {
    return this.membersByRoom.get(conversationId)?.size ?? 0;
  }

  updateRole(conversationId: string, userId: string, role: ConversationMemberRole): void {
    const member = this.findMember(conversationId, userId);
    if (member) this.membersByRoom.get(conversationId)!.set(userId, { ...member, role });
  }

  sharesGroupWith(userIdA: string, userIdB: string): boolean {
    for (const [conversationId, members] of this.membersByRoom) {
      if (this.conversationTypeById.get(conversationId) !== "group") continue;
      if (members.has(userIdA) && members.has(userIdB)) return true;
    }
    return false;
  }
}
