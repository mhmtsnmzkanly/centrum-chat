import type { NotificationRepository } from "./notificationRepository.port.ts";
import {
  type Notification,
  type NotificationSummary,
  toNotificationSummary,
} from "./notification.entity.ts";
import type { UserRepository } from "../users/userRepository.port.ts";
import type { Conversation } from "../conversations/conversation.entity.ts";
import type { MessageSummary } from "../messages/message.entity.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";
import { ForbiddenError } from "../../shared/errors/forbiddenError.ts";
import type { BlockPolicy } from "../safety/safetyPolicy.ts";

/** `@username` mentions, matching the username format enforced at registration
 * (`^[a-zA-Z0-9_]{3,20}$`, see registerRoute.ts). */
const MENTION_PATTERN = /@([a-zA-Z0-9_]{3,20})/g;

export interface NotificationTrigger {
  readonly userId: string;
  readonly notification: NotificationSummary;
}

/** docs/03-websocket-events.md "Module: Notifications". The `notify*` methods only
 * decide *who* gets notified and persist the row (pure domain logic + repository
 * writes); the calling WS handler is responsible for pushing `notification.new` to
 * whichever of those users happen to be connected right now (same "service returns
 * data, handler pushes" split used by ReactionService). */
export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly users: UserRepository,
    private readonly blockPolicy?: BlockPolicy,
  ) {}

  list(userId: string, unreadOnly: boolean): NotificationSummary[] {
    return this.notifications.listForUser(userId, unreadOnly).map(toNotificationSummary);
  }

  markRead(userId: string, notificationId: string): void {
    const notification = this.requireOwn(userId, notificationId);
    this.notifications.markRead(notification.id);
  }

  markAllRead(userId: string): void {
    this.notifications.markAllReadForUser(userId);
  }

  /** DM message -> notify the other member(s) of the DM (regardless of whether they're
   * currently online — that's the whole point of persisting notifications). Channel/group
   * message -> notify any `@username` mentioned in the content, except the author. The
   * two are mutually exclusive triggers per the doc's wording, so a DM never also scans
   * for mentions. */
  notifyForNewMessage(
    room: Conversation,
    message: MessageSummary,
    roomMemberIds: readonly string[],
  ): NotificationTrigger[] {
    if (room.type === "dm") {
      const triggers: NotificationTrigger[] = [];
      for (const userId of roomMemberIds) {
        if (
          userId === message.authorId ||
          (message.authorId &&
            this.blockPolicy?.isBlockedEitherDirection(message.authorId, userId))
        ) continue;
        triggers.push(this.createTrigger({
          userId,
          type: "dm",
          conversationId: room.id,
          messageId: message.id,
        }));
      }
      return triggers;
    }

    const triggers: NotificationTrigger[] = [];
    for (const username of this.extractMentions(message.content)) {
      const user = this.users.findByUsername(username);
      if (
        !user || user.id === message.authorId ||
        (message.authorId &&
          this.blockPolicy?.isBlockedEitherDirection(message.authorId, user.id))
      ) continue;
      triggers.push(this.createTrigger({
        userId: user.id,
        type: "mention",
        conversationId: room.id,
        messageId: message.id,
      }));
    }
    return triggers;
  }

  notifyGroupInvite(invitedUserId: string, groupId: string): NotificationTrigger {
    return this.createTrigger({
      userId: invitedUserId,
      type: "group_invite",
      conversationId: groupId,
      messageId: null,
    });
  }

  /** No-op (returns null) for a self-reaction — reacting to your own message doesn't
   * notify you. */
  notifyReaction(
    messageAuthorId: string | null,
    reactorUserId: string,
    conversationId: string,
    messageId: string,
  ): NotificationTrigger | null {
    if (
      !messageAuthorId || messageAuthorId === reactorUserId ||
      this.blockPolicy?.isBlockedEitherDirection(messageAuthorId, reactorUserId)
    ) return null;
    return this.createTrigger({
      userId: messageAuthorId,
      type: "reaction",
      conversationId,
      messageId,
    });
  }

  private createTrigger(
    input: {
      userId: string;
      type: Notification["type"];
      conversationId: string | null;
      messageId: string | null;
    },
  ): NotificationTrigger {
    const notification = this.notifications.create(input);
    return { userId: input.userId, notification: toNotificationSummary(notification) };
  }

  private extractMentions(content: string): Set<string> {
    return new Set([...content.matchAll(MENTION_PATTERN)].map((match) => match[1] as string));
  }

  private requireOwn(userId: string, notificationId: string): Notification {
    const notification = this.notifications.findById(notificationId);
    if (!notification) throw new NotFoundError("Notification not found.", { notificationId });
    if (notification.userId !== userId) {
      throw new ForbiddenError("This notification does not belong to you.");
    }
    return notification;
  }
}
