import { assertEquals } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteAttachmentRepository } from "../../src/storage/repositories/sqliteAttachmentRepository.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import type { Db } from "../../src/storage/db.ts";

function seedUser(db: Db, id = "u-1") {
  new SqliteUserRepository(db).create({
    id,
    username: id === "u-1" ? "alice" : `user_${id}`,
    displayName: "User",
    email: `${id}@example.com`,
    passwordHash: "hash",
  });
}

function seedMessage(db: Db) {
  seedUser(db);
  const room = new SqliteConversationRepository(db).create({
    id: "c-1",
    type: "channel",
    slug: "attachments-test",
    isPublic: true,
  });
  return new SqliteMessageRepository(db).create({
    id: "m-1",
    conversationId: room.id,
    authorId: "u-1",
    content: "hi",
    replyToId: null,
    isSystem: false,
  });
}

Deno.test("SqliteAttachmentRepository: create/findById round-trips an unattached row", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const attachments = new SqliteAttachmentRepository(db);
    seedUser(db);
    const created = attachments.create({
      id: "a-1",
      uploaderId: "u-1",
      kind: "attachment",
      fileName: "photo.png",
      mimeType: "image/png",
      sizeBytes: 123,
      storagePath: "attachments/a-1",
    });

    assertEquals(created.messageId, null);
    assertEquals(attachments.findById("a-1"), created);
    assertEquals(attachments.findById("no-such-id"), null);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteAttachmentRepository: attachToMessage links the row, listForMessage finds it", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const message = seedMessage(db);
    const attachments = new SqliteAttachmentRepository(db);
    attachments.create({
      id: "a-1",
      uploaderId: "u-1",
      kind: "attachment",
      fileName: "photo.png",
      mimeType: "image/png",
      sizeBytes: 123,
      storagePath: "attachments/a-1",
    });

    assertEquals(attachments.listForMessage(message.id), []);
    attachments.attachToMessage("a-1", message.id);

    const linked = attachments.findById("a-1");
    assertEquals(linked?.messageId, message.id);
    assertEquals(attachments.listForMessage(message.id).map((a) => a.id), ["a-1"]);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteAttachmentRepository: delete removes the row", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const attachments = new SqliteAttachmentRepository(db);
    seedUser(db);
    attachments.create({
      id: "a-1",
      uploaderId: "u-1",
      kind: "avatar",
      fileName: "me.png",
      mimeType: "image/png",
      sizeBytes: 10,
      storagePath: "avatars/a-1",
    });
    attachments.delete("a-1");
    assertEquals(attachments.findById("a-1"), null);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteAttachmentRepository: listExpiredOrphans excludes avatars and attached rows, includes old unattached attachments", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const message = seedMessage(db);
    const attachments = new SqliteAttachmentRepository(db);

    attachments.create({
      id: "orphan",
      uploaderId: "u-1",
      kind: "attachment",
      fileName: "orphan.png",
      mimeType: "image/png",
      sizeBytes: 1,
      storagePath: "attachments/orphan",
    });
    attachments.create({
      id: "avatar",
      uploaderId: "u-1",
      kind: "avatar",
      fileName: "avatar.png",
      mimeType: "image/png",
      sizeBytes: 1,
      storagePath: "avatars/avatar",
    });
    attachments.create({
      id: "attached",
      uploaderId: "u-1",
      kind: "attachment",
      fileName: "attached.png",
      mimeType: "image/png",
      sizeBytes: 1,
      storagePath: "attachments/attached",
    });
    attachments.attachToMessage("attached", message.id);

    // A far-future cutoff makes every already-created row "expired" by created_at,
    // isolating the kind/message_id filtering this test actually cares about.
    const futureCutoff = new Date(Date.now() + 60_000).toISOString();
    const expired = attachments.listExpiredOrphans(futureCutoff);

    assertEquals(expired.map((a) => a.id), ["orphan"]);
  } finally {
    await cleanup();
  }
});
