export type NotificationType = "mention" | "dm" | "group_invite" | "reaction";

export interface Notification {
  readonly id: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly conversationId: string | null;
  readonly messageId: string | null;
  readonly isRead: boolean;
  readonly createdAt: string;
}

/** Wire shape `Notification` from docs/03-websocket-events.md. `userId` is never sent —
 * `notification.list` is always scoped to the caller's own notifications. */
export interface NotificationSummary {
  readonly id: string;
  readonly type: NotificationType;
  readonly conversationId: string | null;
  readonly messageId: string | null;
  readonly isRead: boolean;
  readonly createdAt: string;
}

export function toNotificationSummary(notification: Notification): NotificationSummary {
  return {
    id: notification.id,
    type: notification.type,
    conversationId: notification.conversationId,
    messageId: notification.messageId,
    isRead: notification.isRead,
    createdAt: notification.createdAt,
  };
}
