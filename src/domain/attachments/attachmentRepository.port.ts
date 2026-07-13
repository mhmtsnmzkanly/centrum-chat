import type { Attachment, AttachmentKind } from "./attachment.entity.ts";

export interface NewAttachment {
  readonly id: string;
  readonly uploaderId: string;
  readonly kind: AttachmentKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storagePath: string;
}

/** Port implemented by `storage/repositories/sqliteAttachmentRepository.ts`. */
export interface AttachmentRepository {
  create(attachment: NewAttachment): Attachment;
  findById(id: string): Attachment | null;
  attachToMessage(id: string, messageId: string): void;
  listForMessage(messageId: string): Attachment[];
  delete(id: string): void;
  /** `kind='attachment'` rows never attached to a message before `olderThanIso` — the
   * orphan-cleanup job's candidate list (docs/04-http-api.md "Media Upload"). Avatars are
   * excluded since they're never attached to a message by design. */
  listExpiredOrphans(olderThanIso: string): Attachment[];
}
