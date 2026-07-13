import type { Db } from "../db.ts";
import type {
  AttachmentRepository,
  NewAttachment,
} from "../../domain/attachments/attachmentRepository.port.ts";
import type { Attachment, AttachmentKind } from "../../domain/attachments/attachment.entity.ts";

interface AttachmentRow {
  id: string;
  message_id: string | null;
  uploader_id: string | null;
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    messageId: row.message_id,
    uploaderId: row.uploader_id,
    kind: row.kind as AttachmentKind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storagePath: row.storage_path,
    createdAt: row.created_at,
  };
}

/** All SQL for `attachments` lives here — no SQL outside `storage/repositories/**`. */
export class SqliteAttachmentRepository implements AttachmentRepository {
  constructor(private readonly db: Db) {}

  create(attachment: NewAttachment): Attachment {
    this.db.prepare(
      `INSERT INTO attachments (
         id, uploader_id, kind, file_name, mime_type, size_bytes, storage_path
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      attachment.id,
      attachment.uploaderId,
      attachment.kind,
      attachment.fileName,
      attachment.mimeType,
      attachment.sizeBytes,
      attachment.storagePath,
    );

    const created = this.findById(attachment.id);
    if (!created) throw new Error("Failed to read back newly created attachment.");
    return created;
  }

  findById(id: string): Attachment | null {
    const row = this.db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as
      | AttachmentRow
      | undefined;
    return row ? toAttachment(row) : null;
  }

  attachToMessage(id: string, messageId: string): void {
    const result = this.db.prepare(
      "UPDATE attachments SET message_id = ? WHERE id = ? AND message_id IS NULL",
    ).run(messageId, id);
    if (result.changes !== 1) {
      throw new Error("Failed to attach attachment to message.");
    }
  }

  listForMessage(messageId: string): Attachment[] {
    const rows = this.db.prepare(
      "SELECT * FROM attachments WHERE message_id = ? ORDER BY created_at",
    ).all(messageId) as unknown as AttachmentRow[];
    return rows.map(toAttachment);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
  }

  listExpiredOrphans(olderThanIso: string): Attachment[] {
    const rows = this.db.prepare(
      `SELECT * FROM attachments
       WHERE kind = 'attachment' AND message_id IS NULL AND created_at < ?`,
    ).all(olderThanIso) as unknown as AttachmentRow[];
    return rows.map(toAttachment);
  }
}
