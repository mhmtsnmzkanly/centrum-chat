import type { AttachmentSummary } from "../messages/message.entity.ts";

export type AttachmentKind = "attachment" | "avatar" | "cover";

export interface Attachment {
  readonly id: string;
  readonly messageId: string | null;
  readonly uploaderId: string | null;
  readonly kind: AttachmentKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storagePath: string;
  readonly createdAt: string;
}

/** Wire shape `Attachment` from docs/03-websocket-events.md. `url` is always
 * `/media/:id` — GET /media/:id resolves it to the file on disk via `storagePath`. */
export function toAttachmentSummary(attachment: Attachment): AttachmentSummary {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    url: `/media/${attachment.id}`,
  };
}
