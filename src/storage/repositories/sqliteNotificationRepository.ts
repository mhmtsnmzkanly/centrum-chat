import type { Db } from "../db.ts";
import type {
  NewNotification,
  NotificationRepository,
} from "../../domain/notifications/notificationRepository.port.ts";
import type {
  Notification,
  NotificationType,
} from "../../domain/notifications/notification.entity.ts";

interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  conversation_id: string | null;
  message_id: string | null;
  is_read: number;
  created_at: string;
}

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as NotificationType,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

/** All SQL for `notifications` lives here — no SQL outside `storage/repositories/**`. */
export class SqliteNotificationRepository implements NotificationRepository {
  constructor(private readonly db: Db) {}

  create(notification: NewNotification): Notification {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO notifications (id, user_id, type, conversation_id, message_id)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      notification.userId,
      notification.type,
      notification.conversationId,
      notification.messageId,
    );

    const created = this.findById(id);
    if (!created) throw new Error("Failed to read back newly created notification.");
    return created;
  }

  findById(id: string): Notification | null {
    const row = this.db.prepare("SELECT * FROM notifications WHERE id = ?").get(id) as
      | NotificationRow
      | undefined;
    return row ? toNotification(row) : null;
  }

  listForUser(userId: string, unreadOnly: boolean): Notification[] {
    const sql = unreadOnly
      ? `SELECT * FROM notifications WHERE user_id = ? AND is_read = 0
         ORDER BY created_at DESC, rowid DESC`
      : `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`;
    const rows = this.db.prepare(sql).all(userId) as unknown as NotificationRow[];
    return rows.map(toNotification);
  }

  markRead(id: string): void {
    this.db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
  }

  markAllReadForUser(userId: string): void {
    this.db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0").run(
      userId,
    );
  }
}
