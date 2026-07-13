import type { AttachmentRepository } from "./attachmentRepository.port.ts";
import type { Attachment, AttachmentKind } from "./attachment.entity.ts";
import { generateId } from "../../shared/id.ts";

export interface UploadInput {
  readonly uploaderId: string;
  readonly kind: AttachmentKind;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storagePath: string;
}

/** docs/04-http-api.md "Media Upload". File bytes themselves are written to disk by the
 * HTTP route (application layer) — this service only ever owns the DB row, keeping the
 * domain layer free of filesystem I/O (architecture doc §1). */
export class AttachmentService {
  constructor(private readonly attachments: AttachmentRepository) {}

  recordUpload(input: UploadInput): Attachment {
    return this.attachments.create({ id: generateId(), ...input });
  }

  findById(id: string): Attachment | null {
    return this.attachments.findById(id);
  }

  delete(id: string): void {
    this.attachments.delete(id);
  }

  /** Uploads never attached to a message within `maxAgeMs` are garbage collected
   * (docs/04-http-api.md). Deletes the DB rows and returns them so the caller (the
   * cleanup job in main.ts) can also unlink the corresponding files from disk. */
  sweepExpiredOrphans(maxAgeMs: number): Attachment[] {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const expired = this.attachments.listExpiredOrphans(cutoff);
    for (const attachment of expired) {
      this.attachments.delete(attachment.id);
    }
    return expired;
  }
}
