import type {
  AttachmentRepository,
  NewAttachment,
} from "../../src/domain/attachments/attachmentRepository.port.ts";
import type { Attachment } from "../../src/domain/attachments/attachment.entity.ts";

/** In-memory fake AttachmentRepository — unit tests exercise domain services against
 * fake repos (docs/05-folder-structure.md tests/unit convention), not real SQLite. */
export class FakeAttachmentRepository implements AttachmentRepository {
  private readonly byId = new Map<string, Attachment>();

  create(attachment: NewAttachment): Attachment {
    const created: Attachment = {
      id: attachment.id,
      messageId: null,
      uploaderId: attachment.uploaderId,
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      storagePath: attachment.storagePath,
      createdAt: new Date().toISOString(),
    };
    this.byId.set(created.id, created);
    return created;
  }

  findById(id: string): Attachment | null {
    return this.byId.get(id) ?? null;
  }

  attachToMessage(id: string, messageId: string): void {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, messageId });
  }

  listForMessage(messageId: string): Attachment[] {
    return [...this.byId.values()].filter((a) => a.messageId === messageId);
  }

  delete(id: string): void {
    this.byId.delete(id);
  }

  listExpiredOrphans(olderThanIso: string): Attachment[] {
    return [...this.byId.values()].filter(
      (a) => a.kind === "attachment" && a.messageId === null && a.createdAt < olderThanIso,
    );
  }
}
