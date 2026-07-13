import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteSafetyRepository } from "../../src/storage/repositories/sqliteSafetyRepository.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { ConflictError } from "../../src/shared/errors/conflictError.ts";

function createUser(users: SqliteUserRepository, id: string): void {
  users.create({
    id,
    username: id,
    displayName: id,
    email: id + "@example.com",
    passwordHash: "hash",
  });
}

Deno.test("SqliteSafetyRepository enforces directional unique non-self blocks", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const safety = new SqliteSafetyRepository(db);
    createUser(users, "alice");
    createUser(users, "bob");
    assertEquals(safety.addBlock("alice", "bob"), true);
    assertEquals(safety.addBlock("alice", "bob"), false);
    assertEquals(safety.hasBlockEitherDirection("bob", "alice"), true);
    assertEquals(safety.listBlocked("alice", null, 25).items[0]?.userId, "bob");
    assertEquals(safety.listBlocked("bob", null, 25).items, []);
    assertThrows(() => safety.addBlock("alice", "alice"));
    assertEquals(safety.removeBlock("alice", "bob"), true);
    assertEquals(safety.removeBlock("alice", "bob"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteSafetyRepository constrains report shape, active duplicates, assignment, and status CAS", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const safety = new SqliteSafetyRepository(db);
    createUser(users, "alice");
    createUser(users, "bob");
    createUser(users, "mod");
    safety.setUserRoleByEmail("mod@example.com", "moderator");
    const report = safety.createReport({
      id: "r1",
      reporterUserId: "alice",
      targetType: "user",
      targetId: "bob",
      reasonCode: "spam",
      details: null,
    });
    assertEquals(report.status, "open");
    assertThrows(
      () =>
        safety.createReport({
          id: "r2",
          reporterUserId: "alice",
          targetType: "user",
          targetId: "bob",
          reasonCode: "harassment",
          details: null,
        }),
      ConflictError,
    );
    assertEquals(safety.assignReport("r1", null, "mod", false)?.assignedModeratorId, "mod");
    assertEquals(safety.assignReport("r1", null, "mod", false), null);
    assertEquals(
      safety.transitionReport("r1", "open", "in_review", "2026-01-01T00:00:00.000Z")
        ?.status,
      "in_review",
    );
    assertEquals(
      safety.transitionReport("r1", "open", "dismissed", "2026-01-01T00:00:01.000Z"),
      null,
    );
    assertThrows(() =>
      db.prepare(
        "INSERT INTO reports (id,reporter_user_id,target_type,target_reference_id,target_user_id,target_message_id,reason_code) VALUES (?,?,?,?,?,?,?)",
      ).run("bad", "alice", "user", "bob", "bob", "missing", "spam")
    );
    assertThrows(() =>
      db.prepare(
        "INSERT INTO reports (id,reporter_user_id,target_type,target_reference_id,reason_code) VALUES (?,?,?,?,?)",
      ).run("missing-live-target", "alice", "user", "bob", "spam")
    );
    db.prepare("DELETE FROM users WHERE id='bob'").run();
    assertEquals(safety.findReportById("r1")?.targetId, "bob");
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteSafetyRepository treats sanction expiry without cleanup and keeps audit append-only", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const users = new SqliteUserRepository(db);
    const safety = new SqliteSafetyRepository(db);
    createUser(users, "alice");
    createUser(users, "admin");
    safety.setUserRoleByEmail("admin@example.com", "admin");
    safety.createSanction({
      id: "s1",
      userId: "alice",
      type: "message_mute",
      reasonCode: "spam",
      moderatorNote: null,
      createdByUserId: "admin",
      startsAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T01:00:00.000Z",
    });
    assertEquals(safety.listActiveSanctions("alice", "2026-01-01T00:30:00.000Z").length, 1);
    assertEquals(safety.listActiveSanctions("alice", "2026-01-01T01:00:01.000Z").length, 0);
    const audit = safety.appendAudit({
      id: "a1",
      actorUserId: "admin",
      actorType: "admin",
      actionCode: "sanction.apply",
      targetType: "user",
      targetId: "alice",
      outcome: "success",
      metadata: {
        sanctionType: "message_mute",
        Authorization: "Bearer secret",
        refresh_token_hash: "refresh-secret",
        content: "private message body",
        tokenCount: 7,
        longValue: "x".repeat(500),
      },
    });
    assertEquals(audit.metadata.Authorization, "[REDACTED]");
    assertEquals(audit.metadata.refresh_token_hash, "[REDACTED]");
    assertEquals(audit.metadata.content, "[REDACTED]");
    assertEquals(audit.metadata.tokenCount, 7);
    assertEquals((audit.metadata.longValue as string).length, 128);
    const boundedAudit = safety.appendAudit({
      id: "a2",
      actorUserId: "admin",
      actorType: "admin",
      actionCode: "metadata.bound",
      targetType: null,
      targetId: null,
      outcome: "success",
      metadata: Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => ["field" + index, index]),
      ),
    });
    assertEquals(Object.keys(boundedAudit.metadata).length, 16);
    assertEquals(safety.listAudit({}, null, 25).items.length, 2);
    const tables = db.prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name='captcha_tokens'",
    ).all();
    assertEquals(tables, []);
  } finally {
    await cleanup();
  }
});
