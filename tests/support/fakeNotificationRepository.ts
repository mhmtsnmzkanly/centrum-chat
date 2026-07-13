import type {
  NewNotification,
  NotificationRepository,
} from "../../src/domain/notifications/notificationRepository.port.ts";
import type { Notification } from "../../src/domain/notifications/notification.entity.ts";

/** In-memory fake NotificationRepository — unit tests exercise domain services against
 * fake repos (docs/05-folder-structure.md tests/unit convention), not real SQLite. */
export class FakeNotificationRepository implements NotificationRepository {
  private readonly byId = new Map<string, Notification>();
  private sequence = 0;

  create(notification: NewNotification): Notification {
    this.sequence += 1;
    const created: Notification = {
      id: `n-${this.sequence}`,
      userId: notification.userId,
      type: notification.type,
      conversationId: notification.conversationId,
      messageId: notification.messageId,
      isRead: false,
      createdAt: new Date(Date.now() + this.sequence).toISOString(),
    };
    this.byId.set(created.id, created);
    return created;
  }

  findById(id: string): Notification | null {
    return this.byId.get(id) ?? null;
  }

  listForUser(userId: string, unreadOnly: boolean): Notification[] {
    return [...this.byId.values()]
      .filter((n) => n.userId === userId && (!unreadOnly || !n.isRead))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  markRead(id: string): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, isRead: true });
  }

  markAllReadForUser(userId: string): void {
    for (const [id, notification] of this.byId) {
      if (notification.userId === userId) this.byId.set(id, { ...notification, isRead: true });
    }
  }
}
