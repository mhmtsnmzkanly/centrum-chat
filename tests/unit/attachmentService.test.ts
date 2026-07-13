import { assertEquals } from "jsr:@std/assert@1";
import { AttachmentService } from "../../src/domain/attachments/attachmentService.ts";
import { FakeAttachmentRepository } from "../support/fakeAttachmentRepository.ts";

function makeService() {
  const attachments = new FakeAttachmentRepository();
  const service = new AttachmentService(attachments);
  return { service, attachments };
}

Deno.test("AttachmentService.recordUpload creates an unattached row and returns it", () => {
  const { service } = makeService();
  const attachment = service.recordUpload({
    uploaderId: "u-1",
    kind: "attachment",
    fileName: "photo.png",
    mimeType: "image/png",
    sizeBytes: 42,
    storagePath: "attachments/abc",
  });

  assertEquals(attachment.messageId, null);
  assertEquals(attachment.fileName, "photo.png");
  assertEquals(attachment.mimeType, "image/png");
  assertEquals(attachment.sizeBytes, 42);
  assertEquals(attachment.storagePath, "attachments/abc");
  assertEquals(service.findById(attachment.id), attachment);
});

Deno.test("AttachmentService.findById returns null for an unknown id", () => {
  const { service } = makeService();
  assertEquals(service.findById("no-such-id"), null);
});

Deno.test("AttachmentService.delete removes the row", () => {
  const { service } = makeService();
  const attachment = service.recordUpload({
    uploaderId: "u-1",
    kind: "avatar",
    fileName: "me.png",
    mimeType: "image/png",
    sizeBytes: 10,
    storagePath: "avatars/me",
  });
  service.delete(attachment.id);
  assertEquals(service.findById(attachment.id), null);
});

Deno.test("AttachmentService.sweepExpiredOrphans deletes only unattached attachment-kind rows, and returns them", () => {
  const { service, attachments } = makeService();

  const orphan = service.recordUpload({
    uploaderId: "u-1",
    kind: "attachment",
    fileName: "orphan.png",
    mimeType: "image/png",
    sizeBytes: 1,
    storagePath: "attachments/orphan",
  });
  const avatar = service.recordUpload({
    uploaderId: "u-1",
    kind: "avatar",
    fileName: "avatar.png",
    mimeType: "image/png",
    sizeBytes: 1,
    storagePath: "avatars/avatar",
  });
  const attached = service.recordUpload({
    uploaderId: "u-1",
    kind: "attachment",
    fileName: "attached.png",
    mimeType: "image/png",
    sizeBytes: 1,
    storagePath: "attachments/attached",
  });
  attachments.attachToMessage(attached.id, "m-1");

  // A negative maxAgeMs pushes the cutoff into the future, so every already-created
  // orphan is "expired" without needing to sleep or fake the clock in this test.
  const deleted = service.sweepExpiredOrphans(-1000);

  assertEquals(deleted.map((a) => a.id), [orphan.id]);
  assertEquals(service.findById(orphan.id), null);
  assertEquals(service.findById(avatar.id), avatar);
  assertEquals(service.findById(attached.id)?.messageId, "m-1");
});
