import type { ConversationRepository } from "./conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "./conversationMembershipRepository.port.ts";
import type { UserRepository } from "../users/userRepository.port.ts";
import type { PreferencesRepository } from "../preferences/preferencesRepository.port.ts";
import {
  type Conversation,
  type ConversationSummary,
  toConversationSummary,
} from "./conversation.entity.ts";
import { toUserSummary, type UserSummary } from "../users/user.entity.ts";
import { canAddToGroup } from "./privacyPolicy.ts";
import {
  groupCreatedMessage,
  memberAddedMessage,
  memberLeftMessage,
  memberRemovedMessage,
  ownershipTransferredMessage,
} from "./groupSystemMessages.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";
import { ForbiddenError } from "../../shared/errors/forbiddenError.ts";
import { ConflictError } from "../../shared/errors/conflictError.ts";
import { ValidationError } from "../../shared/errors/validationError.ts";
import { generateId } from "../../shared/id.ts";

export const MIN_GROUP_MEMBERS = 3;
export const MAX_GROUP_MEMBERS = 25;

export interface GroupMutationResult {
  readonly room: ConversationSummary;
  /** Text a Phase-5 message pipeline will persist/broadcast as a system message. */
  readonly systemMessageText: string;
  /** Users newly added to the group by this call — empty for `removeMember` — so the
   * caller can fire `group_invite` notifications (docs/03-websocket-events.md "Module:
   * Notifications") without re-deriving `create`'s dedup/self-exclusion rules itself. */
  readonly addedMemberIds: readonly string[];
}

export interface GroupLeaveResult {
  readonly deleted: boolean;
  readonly systemMessageText: string;
  /** null when `deleted` (no room, and no members left to push to). */
  readonly room: ConversationSummary | null;
}

/** docs/03-websocket-events.md "Module: Groups". Group size (3-25 total members),
 * ownership transfer on the owner leaving, and deletion when the last member leaves are
 * ported directly from the frontend's rules (docs/06-implementation-plan.md Phase 4). */
export class GroupService {
  constructor(
    private readonly rooms: ConversationRepository,
    private readonly roomMembers: ConversationMembershipRepository,
    private readonly users: UserRepository,
    private readonly preferences: PreferencesRepository,
    private readonly maximumMembers: () => number = () => MAX_GROUP_MEMBERS,
  ) {}

  getMembers(callerUserId: string, groupId: string): UserSummary[] {
    const room = this.rooms.findById(groupId);
    if (!room || (room.type !== "group" && room.type !== "dm")) {
      throw new NotFoundError("Group not found.", { groupId });
    }
    if (!this.roomMembers.isMember(room.id, callerUserId)) {
      throw new ForbiddenError("You are not a member of this group.");
    }
    const members = this.roomMembers.listMembers(room.id);
    const userSummaries: UserSummary[] = [];
    for (const member of members) {
      const user = this.users.findById(member.userId);
      if (user) {
        userSummaries.push(toUserSummary(user));
      }
    }
    return userSummaries;
  }

  listGroups(userId: string): ConversationSummary[] {
    return this.rooms.listGroupsForUser(userId).map((room) =>
      toConversationSummary(room, this.roomMembers.countMembers(room.id))
    );
  }

  create(actorUserId: string, name: string, memberIds: readonly string[]): GroupMutationResult {
    const actor = this.requireUser(actorUserId);
    const uniqueMemberIds = [...new Set(memberIds)].filter((id) => id !== actorUserId);
    const totalMembers = uniqueMemberIds.length + 1;
    const maximum = this.maximumMembers();
    if (totalMembers < MIN_GROUP_MEMBERS || totalMembers > maximum) {
      throw new ValidationError(
        `A group must have between ${MIN_GROUP_MEMBERS} and ${maximum} members.`,
        { totalMembers },
      );
    }
    for (const memberId of uniqueMemberIds) {
      this.requireUser(memberId);
    }

    const room = this.rooms.create({
      id: generateId(),
      type: "group",
      name,
      isPublic: false,
      ownerId: actorUserId,
    });
    this.roomMembers.add(room.id, actorUserId, "owner");
    for (const memberId of uniqueMemberIds) {
      this.roomMembers.add(room.id, memberId, "member");
    }

    return {
      room: toConversationSummary(room, totalMembers),
      systemMessageText: groupCreatedMessage(actor.displayName),
      addedMemberIds: uniqueMemberIds,
    };
  }

  addMember(actorUserId: string, groupId: string, targetUserId: string): GroupMutationResult {
    const room = this.requireGroup(groupId);
    this.requireOwnerOrModerator(room, actorUserId);

    if (this.roomMembers.isMember(room.id, targetUserId)) {
      throw new ConflictError("User is already a member of this group.");
    }
    const currentCount = this.roomMembers.countMembers(room.id);
    const maximum = this.maximumMembers();
    if (currentCount >= maximum) {
      throw new ValidationError(`A group cannot have more than ${maximum} members.`);
    }

    const actor = this.requireUser(actorUserId);
    const targetUser = this.requireUser(targetUserId);
    const targetPreferences = this.preferences.getOrCreate(targetUserId);
    const actorHasDmWithTarget = this.rooms.findDmForPair(actorUserId, targetUserId) !== null;
    if (!canAddToGroup(targetPreferences.groupPrivacy, actorHasDmWithTarget)) {
      throw new ForbiddenError("This user cannot be added to groups by you.");
    }

    this.roomMembers.add(room.id, targetUserId, "member");
    return {
      room: toConversationSummary(room, currentCount + 1),
      systemMessageText: memberAddedMessage(actor.displayName, targetUser.displayName),
      addedMemberIds: [targetUserId],
    };
  }

  removeMember(actorUserId: string, groupId: string, targetUserId: string): GroupMutationResult {
    const room = this.requireGroup(groupId);
    this.requireOwner(room, actorUserId);
    if (targetUserId === actorUserId) {
      throw new ValidationError("Use group.leave to remove yourself from a group.");
    }

    const targetMember = this.roomMembers.findMember(room.id, targetUserId);
    if (!targetMember) {
      throw new NotFoundError("User is not a member of this group.", { userId: targetUserId });
    }

    const actor = this.requireUser(actorUserId);
    const targetUser = this.requireUser(targetUserId);
    this.roomMembers.remove(room.id, targetUserId);

    return {
      room: toConversationSummary(room, this.roomMembers.countMembers(room.id)),
      systemMessageText: memberRemovedMessage(actor.displayName, targetUser.displayName),
      addedMemberIds: [],
    };
  }

  leave(userId: string, groupId: string): GroupLeaveResult {
    const room = this.requireGroup(groupId);
    const member = this.roomMembers.findMember(room.id, userId);
    if (!member) throw new NotFoundError("You are not a member of this group.", { groupId });

    const user = this.requireUser(userId);
    this.roomMembers.remove(room.id, userId);

    const remaining = this.roomMembers.listMembers(room.id);
    if (remaining.length === 0) {
      this.rooms.delete(room.id);
      return { deleted: true, systemMessageText: memberLeftMessage(user.displayName), room: null };
    }

    if (member.role === "owner") {
      const oldest = [...remaining].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0]!;
      this.roomMembers.updateRole(room.id, oldest.userId, "owner");
      this.rooms.transferOwnership(room.id, oldest.userId);
      const newOwner = this.requireUser(oldest.userId);
      return {
        deleted: false,
        systemMessageText: `${memberLeftMessage(user.displayName)} ${
          ownershipTransferredMessage(newOwner.displayName)
        }`,
        room: toConversationSummary(room, remaining.length),
      };
    }

    return {
      deleted: false,
      systemMessageText: memberLeftMessage(user.displayName),
      room: toConversationSummary(room, remaining.length),
    };
  }

  private requireUser(userId: string) {
    const user = this.users.findById(userId);
    if (!user) throw new NotFoundError("User not found.", { userId });
    return user;
  }

  private requireGroup(groupId: string): Conversation {
    const room = this.rooms.findById(groupId);
    if (!room || room.type !== "group") throw new NotFoundError("Group not found.", { groupId });
    return room;
  }

  private requireOwnerOrModerator(room: Conversation, userId: string): void {
    const member = this.roomMembers.findMember(room.id, userId);
    if (!member || (member.role !== "owner" && member.role !== "moderator")) {
      throw new ForbiddenError("Only the group owner or a moderator can do this.");
    }
  }

  private requireOwner(room: Conversation, userId: string): void {
    const member = this.roomMembers.findMember(room.id, userId);
    if (!member || member.role !== "owner") {
      throw new ForbiddenError("Only the group owner can do this.");
    }
  }
}
