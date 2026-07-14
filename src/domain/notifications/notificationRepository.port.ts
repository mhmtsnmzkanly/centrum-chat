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
  /** Deletes only rows owned by `userId`; ids belonging to other users are
   * silently skipped. Returns the number of rows actually deleted. */
  deleteByIdsForUser(userId: string, ids: readonly string[]): number;
  /** Returns the number of rows deleted. */
  deleteAllForUser(userId: string): number;
}
