import type { MessageRepository } from "../messages/messageRepository.port.ts";
import type { MessageService } from "../messages/messageService.ts";
import type { MessageSummary } from "../messages/message.entity.ts";
import type { ConversationRepository } from "../conversations/conversationRepository.port.ts";
import type { PermissionService } from "../permissions/permissionService.ts";
import type { UserRepository } from "../users/userRepository.port.ts";
import { toUserSummary, type UserSummary } from "../users/user.entity.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";

const SEARCH_RESULT_LIMIT = 50;

/** docs/03-websocket-events.md "Module: Search". `query` is guaranteed non-empty by the
 * WS handler's validation (`requireString` with `minLength: 1`), so there's no
 * empty-query special case to handle here. */
export class SearchService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly messageService: MessageService,
    private readonly rooms: ConversationRepository,
    private readonly permissions: PermissionService,
    private readonly users: UserRepository,
  ) {}

  /** Scoped to one room (matches the frontend's "search only the active destination"
   * behavior) — same access rule as `message.history`: open for channels, `conversation_memberships`
   * -gated for group/dm. */
  searchMessages(userId: string, conversationId: string, query: string): MessageSummary[] {
    const room = this.rooms.findById(conversationId);
    if (!room) throw new NotFoundError("Conversation not found.", { conversationId });
    this.permissions.requireAccess(room, userId);

    const matches = this.messages.search(conversationId, query, SEARCH_RESULT_LIMIT);
    return this.messageService.toSummaries(matches);
  }

  /** Unscoped — matches any user by username or display name substring, no room/
   * membership check (matching the frontend's global user search). */
  searchUsers(query: string): UserSummary[] {
    return this.users.search(query, SEARCH_RESULT_LIMIT).map(toUserSummary);
  }
}
