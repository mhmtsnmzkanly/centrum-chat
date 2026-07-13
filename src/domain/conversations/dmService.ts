import type { ConversationRepository } from "./conversationRepository.port.ts";
import type { ConversationMembershipRepository } from "./conversationMembershipRepository.port.ts";
import type { DirectConversationPairRepository } from "./directConversationPairRepository.port.ts";
import type { UserRepository } from "../users/userRepository.port.ts";
import type { PreferencesRepository } from "../preferences/preferencesRepository.port.ts";
import { type ConversationSummary, toConversationSummary } from "./conversation.entity.ts";
import { canOpenDm } from "./privacyPolicy.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";
import { ForbiddenError } from "../../shared/errors/forbiddenError.ts";
import { generateId } from "../../shared/id.ts";
import type { TransactionManager } from "../../shared/transactions/transactionManager.ts";
import { canonicalizeDirectConversationPair } from "./directConversationPair.ts";
import type { BlockPolicy, SanctionPolicy } from "../safety/safetyPolicy.ts";
import type { SettingsService } from "../administration/settingsService.ts";
import { MaintenanceModeError } from "../administration/administrationErrors.ts";

const DM_MEMBER_COUNT = 2;

/** docs/03-websocket-events.md "Module: Direct Messages". */
export class DmService {
  constructor(
    private readonly rooms: ConversationRepository,
    private readonly roomMembers: ConversationMembershipRepository,
    private readonly directPairs: DirectConversationPairRepository,
    private readonly users: UserRepository,
    private readonly preferences: PreferencesRepository,
    private readonly transactions: TransactionManager,
    private readonly blockPolicy?: BlockPolicy,
    private readonly sanctionPolicy?: SanctionPolicy,
    private readonly settings?: SettingsService,
  ) {}

  /** Gets-or-creates the canonical DM room for the pair, subject to the target's
   * `dmPrivacy`. Pair-uniqueness is enforced by `findDmForPair` (docs/02-database-schema.md
   * "DM room resolution"), not a DB constraint. */
  openDm(actorUserId: string, targetUserId: string): ConversationSummary {
    if (this.settings && !this.settings.get<boolean>("allow_new_dm")) {
      throw new MaintenanceModeError("New direct messages are currently disabled.");
    }
    canonicalizeDirectConversationPair(actorUserId, targetUserId);
    const targetUser = this.users.findById(targetUserId);
    if (!targetUser) throw new NotFoundError("User not found.", { userId: targetUserId });
    try {
      return this.transactions.run(() => {
        this.sanctionPolicy?.requireCanInteract(actorUserId);
        this.blockPolicy?.requireDirectInteraction(actorUserId, targetUserId);
        const alreadyExists = this.directPairs.findConversationIdByUsers(actorUserId, targetUserId);
        if (alreadyExists) {
          const room = this.rooms.findById(alreadyExists);
          if (!room) throw new Error("Failed to read back existing DM conversation.");
          return toConversationSummary(room, DM_MEMBER_COUNT);
        }

        const targetPreferences = this.preferences.getOrCreate(targetUserId);
        const actorSharesGroupWithTarget = this.roomMembers.sharesGroupWith(
          actorUserId,
          targetUserId,
        );
        if (!canOpenDm(targetPreferences.dmPrivacy, actorSharesGroupWithTarget)) {
          throw new ForbiddenError("This user is not accepting direct messages from you.");
        }

        const room = this.rooms.create({ id: generateId(), type: "dm", isPublic: false });
        this.directPairs.createPair(room.id, actorUserId, targetUserId);
        this.roomMembers.add(room.id, actorUserId, "member");
        this.roomMembers.add(room.id, targetUserId, "member");
        return toConversationSummary(room, DM_MEMBER_COUNT);
      });
    } catch (error) {
      if (!isCanonicalDmPairConflict(error)) throw error;
      this.sanctionPolicy?.requireCanInteract(actorUserId);
      this.blockPolicy?.requireDirectInteraction(actorUserId, targetUserId);
      const conversationId = this.directPairs.findConversationIdByUsers(actorUserId, targetUserId);
      if (!conversationId) throw error;
      const room = this.rooms.findById(conversationId);
      if (!room) throw error;
      return toConversationSummary(room, DM_MEMBER_COUNT);
    }
  }

  listDms(userId: string): ConversationSummary[] {
    return this.rooms.listDmsForUser(userId).map((conversation) =>
      toConversationSummary(conversation, DM_MEMBER_COUNT)
    );
  }
}

function isCanonicalDmPairConflict(error: unknown): boolean {
  const message = typeof error === "object" && error !== null && "message" in error &&
      typeof error.message === "string"
    ? error.message
    : "";
  return /direct_conversation_pairs\.(user_low_id|user_high_id)/.test(message) ||
    /UNIQUE constraint failed: direct_conversation_pairs\.user_low_id, direct_conversation_pairs\.user_high_id/
      .test(
        message,
      );
}
