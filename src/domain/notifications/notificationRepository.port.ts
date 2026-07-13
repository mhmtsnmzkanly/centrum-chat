import type { Notification, NotificationType } from "./notification.entity.ts";

export interface NewNotification {
  readonly userId: string;
  readonly type: NotificationType;
  readonly conversationId: string | null;
  readonly messageId: string | null;
}

/** Port implemented by `storage/repositories/sqliteNotificationRepository.ts`. */
export interface NotificationRepository {
  create(notification: NewNotification): Notification;
  findById(id: string): Notification | null;
  /** Newest first (docs/03-websocket-events.md `notification.list`). */
  listForUser(userId: string, unreadOnly: boolean): Notification[];
  markRead(id: string): void;
  markAllReadForUser(userId: string): void;
}
