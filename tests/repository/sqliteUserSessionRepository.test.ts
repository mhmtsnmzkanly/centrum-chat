import { assertEquals } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteUserRepository } from "../../src/storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";

Deno.test("SqliteUserSessionRepository: create + findByRefreshTokenHash + revoke", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });
    const repo = new SqliteUserSessionRepository(db);

    const created = repo.create({
      id: "rt-1",
      userId: "u-1",
      refreshTokenHash: "hash-of-token",
      deviceLabel: null,
      remembered: false,
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    assertEquals(created.revokedAt, null);

    assertEquals(repo.findByRefreshTokenHash("hash-of-token")?.id, "rt-1");
    assertEquals(repo.findByRefreshTokenHash("no-such-hash"), null);

    assertEquals(repo.revoke("rt-1"), true);
    const revoked = repo.findByRefreshTokenHash("hash-of-token");
    assertEquals(revoked?.revokedAt !== null, true);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteUserSessionRepository.revoke is a compare-and-swap: only the first call claims the session", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });
    const repo = new SqliteUserSessionRepository(db);
    repo.create({
      id: "rt-1",
      userId: "u-1",
      refreshTokenHash: "hash-of-token",
      deviceLabel: null,
      remembered: false,
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });

    assertEquals(repo.revoke("rt-1"), true);
    assertEquals(repo.revoke("rt-1"), false);
    assertEquals(repo.revoke("does-not-exist"), false);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteUserSessionRepository: client metadata roundtrips, rotate updates it, missing values are preserved", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });
    const repo = new SqliteUserSessionRepository(db);

    const withMeta = repo.create({
      id: "rt-1",
      userId: "u-1",
      refreshTokenHash: "hash-1",
      deviceLabel: "Laptop",
      remembered: false,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      ipAddress: "203.0.113.9",
      userAgent: "Firefox/128",
    });
    assertEquals(withMeta.ipAddress, "203.0.113.9");
    assertEquals(withMeta.userAgent, "Firefox/128");

    const withoutMeta = repo.create({
      id: "rt-2",
      userId: "u-1",
      refreshTokenHash: "hash-2",
      deviceLabel: null,
      remembered: false,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    assertEquals(withoutMeta.ipAddress, null);
    assertEquals(withoutMeta.userAgent, null);

    // Rotation from a new client overwrites the stored metadata...
    const nowIso = new Date().toISOString();
    const rotated = repo.rotate("rt-1", "hash-1", "hash-1b", nowIso, nowIso, {
      ipAddress: "198.51.100.7",
      userAgent: "Chrome/130",
    });
    assertEquals(rotated?.ipAddress, "198.51.100.7");
    assertEquals(rotated?.userAgent, "Chrome/130");

    // ...but a rotation without client context keeps the previous values.
    const kept = repo.rotate("rt-1", "hash-1b", "hash-1c", nowIso, nowIso);
    assertEquals(kept?.ipAddress, "198.51.100.7");
    assertEquals(kept?.userAgent, "Chrome/130");
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteUserSessionRepository.listForUser lists active sessions first, then unexpired revoked ones as history", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });
    const repo = new SqliteUserSessionRepository(db);
    const future = new Date(Date.now() + 60_000).toISOString();

    repo.create({
      id: "active-1",
      userId: "u-1",
      refreshTokenHash: "h-1",
      deviceLabel: null,
      remembered: false,
      expiresAt: future,
      ipAddress: "203.0.113.9",
      userAgent: "Firefox/128",
    });
    repo.create({
      id: "revoked-1",
      userId: "u-1",
      refreshTokenHash: "h-2",
      deviceLabel: null,
      remembered: false,
      expiresAt: future,
    });
    repo.revoke("revoked-1");
    repo.create({
      id: "expired-1",
      userId: "u-1",
      refreshTokenHash: "h-3",
      deviceLabel: null,
      remembered: false,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const listed = repo.listForUser("u-1", new Date().toISOString());
    assertEquals(listed.map((s) => s.id), ["active-1", "revoked-1"]);
    assertEquals(listed[0]?.revokedAt, null);
    assertEquals(listed[0]?.ipAddress, "203.0.113.9");
    assertEquals(listed[0]?.userAgent, "Firefox/128");
    assertEquals(listed[1]?.revokedAt !== null, true);
  } finally {
    await cleanup();
  }
});

Deno.test("SqliteUserSessionRepository.cleanupExpiredAndRevoked removes expired and old revoked sessions", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    new SqliteUserRepository(db).create({
      id: "u-1",
      username: "alice",
      displayName: "Alice",
      email: "alice@example.com",
      passwordHash: "hash",
    });
    const repo = new SqliteUserSessionRepository(db);

    repo.create({
      id: "expired",
      userId: "u-1",
      refreshTokenHash: "expired-hash",
      deviceLabel: null,
      remembered: false,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    repo.create({
      id: "revoked-old",
      userId: "u-1",
      refreshTokenHash: "revoked-old-hash",
      deviceLabel: null,
      remembered: false,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    db.prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = ?").run(
      new Date(Date.now() - 60_000).toISOString(),
      "revoked-old",
    );
    repo.create({
      id: "active",
      userId: "u-1",
      refreshTokenHash: "active-hash",
      deviceLabel: null,
      remembered: true,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const removed = repo.cleanupExpiredAndRevoked(
      new Date().toISOString(),
      new Date().toISOString(),
    );
    assertEquals(removed, 2);
    assertEquals(repo.findByRefreshTokenHash("expired-hash"), null);
    assertEquals(repo.findByRefreshTokenHash("revoked-old-hash"), null);
    assertEquals(repo.findByRefreshTokenHash("active-hash")?.id, "active");
  } finally {
    await cleanup();
  }
});
