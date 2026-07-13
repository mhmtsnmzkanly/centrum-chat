import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteSafetyRepository } from "../../src/storage/repositories/sqliteSafetyRepository.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteMessageRepository } from "../../src/storage/repositories/sqliteMessageRepository.ts";
import { SqliteAttachmentRepository } from "../../src/storage/repositories/sqliteAttachmentRepository.ts";
import { SqliteConversationRepository } from "../../src/storage/repositories/sqliteConversationRepository.ts";
import { SqliteConversationMembershipRepository } from "../../src/storage/repositories/sqliteConversationMembershipRepository.ts";
import { SqliteDirectConversationPairRepository } from "../../src/storage/repositories/sqliteDirectConversationPairRepository.ts";
import { SqlitePreferencesRepository } from "../../src/storage/repositories/sqlitePreferencesRepository.ts";
import { SqliteReactionRepository } from "../../src/storage/repositories/sqliteReactionRepository.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { SafetyService } from "../../src/domain/safety/safetyService.ts";
import { BlockPolicy, SanctionPolicy } from "../../src/domain/safety/safetyPolicy.ts";
import { PermissionService } from "../../src/domain/permissions/permissionService.ts";
import { DmService } from "../../src/domain/conversations/dmService.ts";
import { MessageService } from "../../src/domain/messages/messageService.ts";
import { RateLimiter } from "../../src/shared/rateLimit/rateLimiter.ts";
import {
  AccountSuspendedError,
  BlockedInteractionError,
  MessageMutedError,
} from "../../src/domain/safety/safetyErrors.ts";
import { ForbiddenError } from "../../src/shared/errors/forbiddenError.ts";
import { NotFoundError } from "../../src/shared/errors/notFoundError.ts";
import { ConflictError } from "../../src/shared/errors/conflictError.ts";
import { ValidationError } from "../../src/shared/errors/validationError.ts";
import { ConnectionManager } from "../../src/transport/websocket/connectionManager.ts";
import { WebSocketHandlerRegistry } from "../../src/application/websocket/registry.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { handleWsUpgrade } from "../../src/transport/http/wsUpgrade.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { BlockUserRoute } from "../../src/application/http/routes/safety/safetyRoutes.ts";
import { ListReportsRoute } from "../../src/application/http/routes/moderation/moderationRoutes.ts";

async function harness() {
  const database = await createTestDb();
  const users = new SqliteUserRepository(database.db);
  const safetyRepo = new SqliteSafetyRepository(database.db);
  const messages = new SqliteMessageRepository(database.db);
  const attachments = new SqliteAttachmentRepository(database.db);
  const conversations = new SqliteConversationRepository(database.db);
  const memberships = new SqliteConversationMembershipRepository(database.db);
  const pairs = new SqliteDirectConversationPairRepository(database.db);
  const preferences = new SqlitePreferencesRepository(database.db);
  const reactions = new SqliteReactionRepository(database.db);
  const transactions = new SqliteTransactionManager(database.db);
  const permissions = new PermissionService(memberships);
  let now = Date.UTC(2026, 0, 1);
  const blockPolicy = new BlockPolicy(safetyRepo);
  const sanctionPolicy = new SanctionPolicy(safetyRepo, () => now);
  const connections = new ConnectionManager();
  const safety = new SafetyService({
    safety: safetyRepo,
    users,
    messages,
    attachments,
    conversations,
    permissions,
    transactions,
    now: () => now,
    onAccountSuspended: (userId) => connections.closeUserConnections(userId),
  });
  const messageService = new MessageService(
    messages,
    conversations,
    permissions,
    new RateLimiter({ maxTokens: 1000, refillIntervalMs: 1000 }),
    transactions,
    reactions,
    attachments,
    {
      requireMessage(userId, room) {
        sanctionPolicy.requireCanMessage(userId);
        if (room.type === "dm") {
          const other = memberships.listMembers(room.id).find((member) => member.userId !== userId);
          if (other) blockPolicy.requireDirectInteraction(userId, other.userId);
        }
      },
    },
  );
  const dmService = new DmService(
    conversations,
    memberships,
    pairs,
    users,
    preferences,
    transactions,
    blockPolicy,
    sanctionPolicy,
  );
  function user(id: string): void {
    users.create({
      id,
      username: id,
      displayName: id,
      email: id + "@example.com",
      passwordHash: "hash",
    });
  }
  return {
    ...database,
    users,
    safetyRepo,
    safety,
    blockPolicy,
    sanctionPolicy,
    connections,
    messageService,
    dmService,
    conversations,
    memberships,
    messages,
    attachments,
    user,
    advance(ms: number) {
      now += ms;
    },
  };
}

Deno.test("blocks are directional records but bidirectionally enforce DM, message, search/profile policy, and preserve groups", async () => {
  const h = await harness();
  try {
    h.user("alice");
    h.user("bob");
    const dm = h.dmService.openDm("alice", "bob");
    h.safety.block("alice", "bob");
    assertEquals(h.safetyRepo.listBlocked("alice", null, 25).items.length, 1);
    assertEquals(h.safetyRepo.listBlocked("bob", null, 25).items.length, 0);
    assertThrows(() => h.dmService.openDm("alice", "bob"), BlockedInteractionError);
    assertThrows(() => h.dmService.openDm("bob", "alice"), BlockedInteractionError);
    assertThrows(
      () => h.messageService.send("alice", dm.id, "blocked", null),
      BlockedInteractionError,
    );
    assertThrows(
      () => h.messageService.send("bob", dm.id, "blocked", null),
      BlockedInteractionError,
    );
    assertEquals(h.blockPolicy.isBlockedEitherDirection("alice", "bob"), true);

    const group = h.conversations.create({
      id: "group",
      type: "group",
      name: "Shared",
      ownerId: "alice",
      isPublic: false,
    });
    h.memberships.add(group.id, "alice", "owner");
    h.memberships.add(group.id, "bob", "member");
    assertEquals(
      h.messageService.send("bob", group.id, "shared group remains intact", null).content,
      "shared group remains intact",
    );

    h.safety.unblock("alice", "bob");
    assertEquals(h.messageService.send("bob", dm.id, "restored", null).content, "restored");
  } finally {
    await h.cleanup();
  }
});

Deno.test("reports authorize targets, resist private enumeration, deduplicate active targets, and CAS workflow", async () => {
  const h = await harness();
  try {
    h.user("alice");
    h.user("bob");
    h.user("moderator");
    h.user("admin");
    h.user("owner");
    h.safetyRepo.setUserRoleByEmail("moderator@example.com", "moderator");
    h.safetyRepo.setUserRoleByEmail("admin@example.com", "admin");
    h.safetyRepo.setUserRoleByEmail("owner@example.com", "owner");
    const channel = h.conversations.findBySlug("general")!;
    const publicMessage = h.messages.create({
      id: "public-message",
      conversationId: channel.id,
      authorId: "bob",
      content: "reported body must not enter audit metadata",
      replyToId: null,
      isSystem: false,
    });
    const report = h.safety.createReport(
      "alice",
      "message",
      publicMessage.id,
      "harassment",
      "bounded details",
    );
    const publicAttachment = h.attachments.create({
      id: "public-attachment",
      uploaderId: "bob",
      kind: "attachment",
      fileName: "evidence.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      storagePath: "private/path-is-never-exposed",
    });
    h.attachments.attachToMessage(publicAttachment.id, publicMessage.id);
    assertEquals(
      h.safety.createReport(
        "alice",
        "attachment",
        publicAttachment.id,
        "privacy",
        null,
      ).targetType,
      "attachment",
    );
    assertThrows(
      () => h.safety.createReport("alice", "message", publicMessage.id, "spam", null),
      ConflictError,
    );

    const privateRoom = h.conversations.create({
      id: "private",
      type: "group",
      name: "Private",
      ownerId: "bob",
      isPublic: false,
    });
    h.memberships.add(privateRoom.id, "bob", "owner");
    h.messages.create({
      id: "private-message",
      conversationId: privateRoom.id,
      authorId: "bob",
      content: "private",
      replyToId: null,
      isSystem: false,
    });
    const privateAttachment = h.attachments.create({
      id: "private-attachment",
      uploaderId: "bob",
      kind: "attachment",
      fileName: "private.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      storagePath: "secret/storage/path",
    });
    h.attachments.attachToMessage(privateAttachment.id, "private-message");
    for (const targetId of ["private-message", "random-message"]) {
      assertThrows(
        () => h.safety.createReport("alice", "message", targetId, "other", null),
        NotFoundError,
      );
    }
    for (const targetId of ["private-attachment", "random-attachment"]) {
      assertThrows(
        () => h.safety.createReport("alice", "attachment", targetId, "other", null),
        NotFoundError,
      );
    }
    assertThrows(() => h.safety.listReports("alice", {}, null, 25), ForbiddenError);
    assertThrows(() => h.safety.listReports("deleted-user", {}, null, 25), ForbiddenError);
    const assigned = h.safety.assignReport("moderator", report.id, null, null);
    assertEquals(assigned.assignedModeratorId, "moderator");
    const ownerAssignedReport = h.safety.createReport("alice", "user", "bob", "spam", null);
    const userContext = h.safety.getReportContext("moderator", ownerAssignedReport.id, 10, 10);
    assertExists(userContext.target);
    assertEquals(userContext.target.id, "bob");
    assertEquals("passwordHash" in userContext.target, false);
    assertEquals("email" in userContext.target, false);
    assertEquals(
      h.safety.assignReport("owner", ownerAssignedReport.id, null, "admin").assignedModeratorId,
      "admin",
    );
    assertThrows(
      () => h.safety.assignReport("moderator", report.id, null, null),
      ConflictError,
    );
    assertEquals(
      h.safety.transitionReport("moderator", report.id, "open", "in_review").status,
      "in_review",
    );
    assertThrows(
      () => h.safety.transitionReport("moderator", report.id, "open", "dismissed"),
      ConflictError,
    );
    const context = h.safety.getReportContext("moderator", report.id, 20, 20);
    assertEquals(context.context.length <= 41, true);
    const audit = h.safety.listAudit("admin", {}, null, 100);
    assertEquals(audit.items.some((event) => event.actionCode === "report.context.view"), true);
    const auditJson = JSON.stringify(audit);
    assertEquals(auditJson.includes("reported body"), false);
    assertEquals(auditJson.includes("bounded details"), false);
    assertEquals(
      audit.items.some((event) => event.actionCode === "moderation.authorization"),
      true,
    );
    assertEquals(
      audit.items.some((event) =>
        event.actionCode === "moderation.authorization" && event.actorUserId === null
      ),
      true,
    );
  } finally {
    await h.cleanup();
  }
});

Deno.test("sanctions enforce trusted-time expiry, role limits, active socket cleanup, and reconnect rejection", async () => {
  const h = await harness();
  try {
    h.user("alice");
    h.user("bob");
    h.user("moderator");
    h.user("admin");
    h.user("admin2");
    h.safetyRepo.setUserRoleByEmail("moderator@example.com", "moderator");
    h.safetyRepo.setUserRoleByEmail("admin@example.com", "admin");
    h.safetyRepo.setUserRoleByEmail("admin2@example.com", "admin");
    const channel = h.conversations.findBySlug("general")!;
    h.safety.applySanction(
      "moderator",
      "alice",
      "message_mute",
      "spam",
      null,
      null,
      "2026-01-01T00:01:00.000Z",
    );
    assertThrows(
      () => h.messageService.send("alice", channel.id, "muted", null),
      MessageMutedError,
    );
    assertEquals(
      h.messageService.send("bob", channel.id, "unaffected", null).content,
      "unaffected",
    );
    h.advance(61_000);
    assertEquals(
      h.messageService.send("alice", channel.id, "expired", null).content,
      "expired",
    );
    assertThrows(() =>
      h.safety.applySanction(
        "moderator",
        "alice",
        "account_suspension",
        "threats",
        null,
        null,
        null,
      ), ForbiddenError);
    assertThrows(() =>
      h.safety.applySanction(
        "admin",
        "alice",
        "account_suspension",
        "threats",
        null,
        "2026-01-01T00:05:00.000Z",
        null,
      ), ValidationError);
    assertThrows(() =>
      h.safety.applySanction(
        "moderator",
        "admin",
        "message_mute",
        "spam",
        null,
        null,
        "2026-01-02T00:00:00.000Z",
      ), ForbiddenError);

    h.connections.reserveConnection({
      connectionId: "alice-connection",
      userId: "alice",
      clientIp: "127.0.0.1",
    });
    h.connections.markOpen("alice-connection");
    h.safety.applySanction(
      "admin",
      "alice",
      "account_suspension",
      "threats",
      null,
      null,
      null,
    );
    assertEquals(h.connections.countConnectionsForUser("alice"), 0);

    const tokens = new TokenService({ secret: "test-secret", accessTokenTtlSeconds: 900 });
    const accessToken = await tokens.signAccessToken("alice", "alice", "session");
    const response = await handleWsUpgrade(
      new Request("http://chat.test/ws?token=" + encodeURIComponent(accessToken), {
        headers: { Upgrade: "websocket" },
      }),
      {
        clientIp: "127.0.0.1",
        registry: new WebSocketHandlerRegistry(h.sanctionPolicy),
        connectionManager: h.connections,
        codec: new JsonCodec(),
        logger: createLogger("error", "safety-test"),
        tokenService: tokens,
        sanctionPolicy: h.sanctionPolicy,
      },
    );
    assertEquals(response.status, 403);

    const headers = { authorization: "Bearer " + accessToken };
    await assertRejects(
      () =>
        new BlockUserRoute(h.safety, tokens, new JsonCodec()).handle({
          request: new Request("http://chat.test/api/safety/blocks/bob", {
            method: "PUT",
            headers,
          }),
          params: { userId: "bob" },
          clientIp: "127.0.0.1",
        }),
      AccountSuspendedError,
    );

    const adminToken = await tokens.signAccessToken("admin", "admin", "admin-session");
    h.safety.applySanction(
      "admin2",
      "admin",
      "account_suspension",
      "security",
      null,
      null,
      null,
    );
    await assertRejects(
      () =>
        new ListReportsRoute(h.safety, tokens, new JsonCodec()).handle({
          request: new Request("http://chat.test/api/moderation/reports", {
            headers: { authorization: "Bearer " + adminToken },
          }),
          params: {},
          clientIp: "127.0.0.1",
        }),
      AccountSuspendedError,
    );
  } finally {
    await h.cleanup();
  }
});
