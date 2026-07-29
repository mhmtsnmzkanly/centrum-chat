import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { ConnectionManager } from "../../src/transport/websocket/connectionManager.ts";
import { CreateGroupHandler } from "../../src/application/websocket/handlers/groups/createGroupHandler.ts";
import { SendMessageHandler } from "../../src/application/websocket/handlers/messages/sendMessageHandler.ts";
import { ConversationReadService } from "../../src/domain/conversations/conversationReadService.ts";
import { DmService } from "../../src/domain/conversations/dmService.ts";
import { GroupService } from "../../src/domain/conversations/groupService.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { NotificationService } from "../../src/domain/notifications/notificationService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import { SqliteAttachmentRepository } from "../../src/storage/repositories/sqliteAttachmentRepository.ts";
import { SqliteConversationMembershipRepository } from "../../src/storage/repositories/sqliteConversationMembershipRepository.ts";
import { SqliteConversationReadRepository } from "../../src/storage/repositories/sqliteConversationReadRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteDirectConversationPairRepository } from "../../src/storage/repositories/sqliteDirectConversationPairRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import { SqliteNotificationRepository } from "../../src/storage/repositories/sqliteNotificationRepository.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";
import { SqliteReactionRepository } from "../../src/storage/repositories/sqliteReactionRepository.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { createTestDb } from "../support/testDatabase.ts";
import type {
  ConversationMemberRole,
  ConversationMembershipRepository,
} from "../../src/domain/conversations/conversationMembershipRepository.port.ts";
import type { DirectConversationPairRepository } from "../../src/domain/conversations/directConversationPairRepository.port.ts";
import type { MessageRepository } from "../../src/domain/messages/messageRepository.port.ts";
import type { AttachmentRepository } from "../../src/domain/attachments/attachmentRepository.port.ts";
import { FakeReactionRepository } from "../support/fakeReactionRepository.ts";
import { FakeAttachmentRepository } from "../support/fakeAttachmentRepository.ts";

function makeUser(
  users: SqliteUserRepository,
  id: string,
  displayName = id,
): void {
  users.create({
    id,
    username: id,
    displayName,
    email: `${id}@example.com`,
    passwordHash: "hash",
  });
}

class FailingMembershipRepository implements ConversationMembershipRepository {
  private addCalls = 0;

  constructor(
    private readonly inner: ConversationMembershipRepository,
    private readonly failOnAddCall: number | null,
    private readonly error: Error = new Error("injected membership failure"),
  ) {}

  add(conversationId: string, userId: string, role: ConversationMemberRole): void {
    this.addCalls += 1;
    if (this.failOnAddCall === this.addCalls) {
      throw this.error;
    }
    this.inner.add(conversationId, userId, role);
  }

  remove(conversationId: string, userId: string): void {
    this.inner.remove(conversationId, userId);
  }

  findMember(conversationId: string, userId: string) {
    return this.inner.findMember(conversationId, userId);
  }

  listMembers(conversationId: string) {
    return this.inner.listMembers(conversationId);
  }

  isMember(conversationId: string, userId: string) {
    return this.inner.isMember(conversationId, userId);
  }

  countMembers(conversationId: string) {
    return this.inner.countMembers(conversationId);
  }

  updateRole(conversationId: string, userId: string, role: ConversationMemberRole): void {
    this.inner.updateRole(conversationId, userId, role);
  }

  sharesGroupWith(userIdA: string, userIdB: string) {
    return this.inner.sharesGroupWith(userIdA, userIdB);
  }
}

class FlakyDirectConversationPairRepository implements DirectConversationPairRepository {
  private lookupCalls = 0;

  constructor(
    private readonly inner: DirectConversationPairRepository,
    private readonly nullLookupsBeforeDelegation: number,
    private readonly createError: Error | null = null,
  ) {}

  findConversationIdByUsers(userAId: string, userBId: string): string | null {
    this.lookupCalls += 1;
    if (this.lookupCalls <= this.nullLookupsBeforeDelegation) {
      return null;
    }
    return this.inner.findConversationIdByUsers(userAId, userBId);
  }

  createPair(conversationId: string, userAId: string, userBId: string): void {
    if (this.createError) {
      throw this.createError;
    }
    this.inner.createPair(conversationId, userAId, userBId);
  }
}

class FailingMessageRepository implements MessageRepository {
  private createCalls = 0;

  constructor(
    private readonly inner: MessageRepository,
    private readonly failOnCreateCall: number | null,
    private readonly error: Error = new Error("injected message failure"),
  ) {}

  create(message: Parameters<MessageRepository["create"]>[0]) {
    this.createCalls += 1;
    if (this.failOnCreateCall === this.createCalls) {
      throw this.error;
    }
    return this.inner.create(message);
  }

  findById(id: string) {
    return this.inner.findById(id);
  }

  findByClientOperationId(authorId: string, clientOperationId: string) {
    return this.inner.findByClientOperationId(authorId, clientOperationId);
  }

  updateContent(id: string, content: string) {
    return this.inner.updateContent(id, content);
  }

  softDelete(id: string) {
    return this.inner.softDelete(id);
  }

  history(conversationId: string, before: string | null, limit: number) {
    return this.inner.history(conversationId, before, limit);
  }

  search(conversationId: string, query: string, limit: number) {
    return this.inner.search(conversationId, query, limit);
  }
}

class FailingAttachmentRepository implements AttachmentRepository {
  private remainingFailures: number;

  constructor(
    private readonly inner: AttachmentRepository,
    failOnAttachCall: number | null,
    private readonly error: Error = new Error("injected attachment failure"),
  ) {
    this.remainingFailures = failOnAttachCall ?? 0;
  }

  create(attachment: Parameters<AttachmentRepository["create"]>[0]) {
    return this.inner.create(attachment);
  }

  findById(id: string) {
    return this.inner.findById(id);
  }

  attachToMessage(id: string, messageId: string): void {
    if (this.remainingFailures > 0) {
      this.remainingFailures -= 1;
      throw this.error;
    }
    this.inner.attachToMessage(id, messageId);
  }

  listForMessage(messageId: string) {
    return this.inner.listForMessage(messageId);
  }

  delete(id: string): void {
    this.inner.delete(id);
  }

  listExpiredOrphans(olderThanIso: string) {
    return this.inner.listExpiredOrphans(olderThanIso);
  }
}

function makePushRecorder(connectionManager: ConnectionManager) {
  const pushes: Array<{ userId: string; encoded: string }> = [];
  (connectionManager as unknown as { sendToUser: (userId: string, encoded: string) => void })
    .sendToUser = (
      userId,
      encoded,
    ) => {
      pushes.push({ userId, encoded });
    };
  return pushes;
}

type CountQueryDb = {
  prepare(sql: string): {
    get(...args: never[]): unknown;
  };
};

function countRows(db: CountQueryDb, sql: string): number {
  const row = db.prepare(sql).get() as { count: number };
  return row.count;
}

Deno.test("DmService rolls back the DM conversation when the first membership insert fails", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const rooms = new SqliteConversationRepository(db);
    const memberships = new FailingMembershipRepository(
      new SqliteConversationMembershipRepository(db),
      1,
    );
    const pairs = new SqliteDirectConversationPairRepository(db);
    const preferences = new SqlitePreferencesRepository(db);
    const transactions = new SqliteTransactionManager(db);
    const service = new DmService(
      rooms,
      memberships,
      pairs,
      users,
      preferences,
      transactions,
    );

    makeUser(users, "alice");
    makeUser(users, "bob");
    preferences.getOrCreate("bob");

    assertThrows(() => service.openDm("alice", "bob"), Error, "injected membership failure");
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM conversations WHERE type = 'dm'"), 0);
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM conversation_memberships"), 0);
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM direct_conversation_pairs"), 0);
    assertEquals(pairs.findConversationIdByUsers("alice", "bob"), null);
  } finally {
    await cleanup();
  }
});

Deno.test("DmService rolls back the DM conversation when the second membership insert fails", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const rooms = new SqliteConversationRepository(db);
    const memberships = new FailingMembershipRepository(
      new SqliteConversationMembershipRepository(db),
      2,
    );
    const pairs = new SqliteDirectConversationPairRepository(db);
    const preferences = new SqlitePreferencesRepository(db);
    const transactions = new SqliteTransactionManager(db);
    const service = new DmService(
      rooms,
      memberships,
      pairs,
      users,
      preferences,
      transactions,
    );

    makeUser(users, "alice");
    makeUser(users, "bob");
    preferences.getOrCreate("bob");

    assertThrows(() => service.openDm("alice", "bob"), Error, "injected membership failure");
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM conversations WHERE type = 'dm'"), 0);
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM conversation_memberships"), 0);
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM direct_conversation_pairs"), 0);
  } finally {
    await cleanup();
  }
});

Deno.test("DmService falls back to the winning conversation when the canonical pair races", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const rooms = new SqliteConversationRepository(db);
    const memberships = new SqliteConversationMembershipRepository(db);
    const realPairs = new SqliteDirectConversationPairRepository(db);
    // Both authoritative transactional lookups miss; after the loser rolls back,
    // the fallback lookup observes the already committed canonical winner.
    const pairs = new FlakyDirectConversationPairRepository(realPairs, 2);
    const preferences = new SqlitePreferencesRepository(db);
    const transactions = new SqliteTransactionManager(db);
    const service = new DmService(
      rooms,
      memberships,
      pairs,
      users,
      preferences,
      transactions,
    );

    makeUser(users, "alice");
    makeUser(users, "bob");
    preferences.getOrCreate("bob");

    const first = service.openDm("alice", "bob");
    const second = service.openDm("bob", "alice");
    assertEquals(first.id, second.id);
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM conversations WHERE type = 'dm'"), 1);
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM direct_conversation_pairs"), 1);
  } finally {
    await cleanup();
  }
});

Deno.test("CreateGroupHandler commits the full group workflow and emits post-commit pushes", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const rooms = new SqliteConversationRepository(db);
    const memberships = new SqliteConversationMembershipRepository(db);
    const messages = new SqliteMessageRepository(db);
    const preferences = new SqlitePreferencesRepository(db);
    const notifications = new SqliteNotificationRepository(db);
    const notificationService = new NotificationService(notifications, users);
    const messageService = new MessageService(
      messages,
      rooms,
      new PermissionService(memberships),
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 1000 }),
      new SqliteTransactionManager(db),
      new FakeReactionRepository(),
      new FakeAttachmentRepository(),
    );
    const transactionManager = new SqliteTransactionManager(db);
    const connectionManager = new ConnectionManager();
    const pushes = makePushRecorder(connectionManager);
    const codec = new JsonCodec();
    const handler = new CreateGroupHandler(
      new GroupService(rooms, memberships, users, preferences),
      messageService,
      rooms,
      memberships,
      notificationService,
      transactionManager,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 1000 }),
      connectionManager,
      codec,
    );

    makeUser(users, "owner", "Owner");
    makeUser(users, "u-1", "User One");
    makeUser(users, "u-2", "User Two");

    const result = handler.handle(
      { userId: "owner", connectionId: "conn-1" },
      { name: "Study Group", memberIds: ["u-1", "u-2"] },
    );

    assertEquals(result.room.type, "group");
    assertEquals(
      countRows(db, "SELECT COUNT(*) AS count FROM conversations WHERE type = 'group'"),
      1,
    );
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM conversation_memberships"), 3);
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM notifications"), 2);
    assertEquals(pushes.length > 0, true);
  } finally {
    await cleanup();
  }
});

Deno.test("CreateGroupHandler rolls back the group workflow and emits nothing when system message persistence fails", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const rooms = new SqliteConversationRepository(db);
    const membershipRepo = new SqliteConversationMembershipRepository(db);
    const failingMemberships = new SqliteConversationMembershipRepository(db);
    const messages = new FailingMessageRepository(new SqliteMessageRepository(db), 1);
    const preferences = new SqlitePreferencesRepository(db);
    const notifications = new SqliteNotificationRepository(db);
    const notificationService = new NotificationService(notifications, users);
    const messageService = new MessageService(
      messages,
      rooms,
      new PermissionService(failingMemberships),
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 1000 }),
      new SqliteTransactionManager(db),
      new FakeReactionRepository(),
      new FakeAttachmentRepository(),
    );
    const transactionManager = new SqliteTransactionManager(db);
    const connectionManager = new ConnectionManager();
    const pushes = makePushRecorder(connectionManager);
    const codec = new JsonCodec();
    const handler = new CreateGroupHandler(
      new GroupService(rooms, membershipRepo, users, preferences),
      messageService,
      rooms,
      membershipRepo,
      notificationService,
      transactionManager,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 1000 }),
      connectionManager,
      codec,
    );

    makeUser(users, "owner", "Owner");
    makeUser(users, "u-1", "User One");
    makeUser(users, "u-2", "User Two");

    assertThrows(
      () =>
        handler.handle(
          { userId: "owner", connectionId: "conn-1" },
          { name: "Study Group", memberIds: ["u-1", "u-2"] },
        ),
      Error,
      "injected message failure",
    );

    assertEquals(
      countRows(db, "SELECT COUNT(*) AS count FROM conversations WHERE type = 'group'"),
      0,
    );
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM conversation_memberships"), 0);
    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM notifications"), 0);
    assertEquals(pushes.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("SendMessageHandler rolls back the message when attachment binding fails and emits nothing", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const rooms = new SqliteConversationRepository(db);
    const memberships = new SqliteConversationMembershipRepository(db);
    const reads = new SqliteConversationReadRepository(db);
    const messages = new SqliteMessageRepository(db);
    const attachments = new FailingAttachmentRepository(new SqliteAttachmentRepository(db), 1);
    const notificationService = new NotificationService(
      new SqliteNotificationRepository(db),
      users,
    );
    const permissions = new PermissionService(memberships);
    const messageService = new MessageService(
      messages,
      rooms,
      permissions,
      new RateLimiter({ maxTokens: 100, refillIntervalMs: 1000 }),
      new SqliteTransactionManager(db),
      new SqliteReactionRepository(db),
      attachments,
    );
    const connectionManager = new ConnectionManager();
    const pushes = makePushRecorder(connectionManager);
    const handler = new SendMessageHandler(
      messageService,
      new ConversationReadService(reads, rooms, permissions),
      rooms,
      memberships,
      notificationService,
      connectionManager,
      new JsonCodec(),
    );

    makeUser(users, "alice", "Alice");
    makeUser(users, "bob", "Bob");
    const room = rooms.create({ id: "g-1", type: "group", isPublic: false, ownerId: "alice" });
    memberships.add(room.id, "alice", "owner");
    memberships.add(room.id, "bob", "member");

    const upload = attachments.create({
      id: "att-1",
      uploaderId: "alice",
      kind: "attachment",
      fileName: "photo.png",
      mimeType: "image/png",
      sizeBytes: 123,
      storagePath: "attachments/att-1",
    });

    assertThrows(
      () =>
        handler.handle(
          { userId: "alice", connectionId: "conn-1" },
          { conversationId: room.id, content: "hello", attachmentId: upload.id },
        ),
      Error,
      "injected attachment failure",
    );

    assertEquals(countRows(db, "SELECT COUNT(*) AS count FROM messages"), 0);
    assertEquals(
      db.prepare("SELECT message_id AS message_id FROM attachments WHERE id = ?").get(upload.id) as
        | { message_id: string | null }
        | undefined,
      { message_id: null },
    );
    assertEquals(pushes.length, 0);
  } finally {
    await cleanup();
  }
});
