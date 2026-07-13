import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1";
import { createTestDb } from "../support/testDatabase.ts";
import { SqliteAdministrationRepository } from "../../src/storage/repositories/sqliteAdministrationRepository.ts";
import { SqliteUserSessionRepository } from "../../src/storage/repositories/sqliteUserSessionRepository.ts";
import { SqliteSafetyRepository } from "../../src/storage/repositories/sqliteSafetyRepository.ts";
import { SqliteTransactionManager } from "../../src/storage/db.ts";
import { AdministrationService } from "../../src/domain/administration/administrationService.ts";
import { ROLE_PERMISSIONS } from "../../src/domain/administration/permissionRegistry.ts";
import { SettingsService } from "../../src/domain/administration/settingsService.ts";
import { RuntimePolicy } from "../../src/domain/administration/runtimePolicy.ts";
import {
  AccountDisabledError,
  ChannelUpdateConflictError,
  FinalOwnerProtectedError,
  MaintenanceModeError,
  PermissionDeniedError,
  RegistrationDisabledError,
  RoleConflictError,
  RoleHierarchyViolationError,
  SettingNotSupportedError,
  SettingUpdateConflictError,
  SettingValidationError,
  UserUpdateConflictError,
} from "../../src/domain/administration/administrationErrors.ts";
import type { SystemRole } from "../../src/domain/administration/administration.entity.ts";
import { UpdateAdminUserRoute } from "../../src/application/http/routes/administration/administrationRoutes.ts";
import { TokenService } from "../../src/domain/auth/tokenService.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { ValidationError } from "../../src/shared/errors/validationError.ts";
import { WebSocketHandlerRegistry } from "../../src/application/websocket/registry.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";

async function harness() {
  const database = await createTestDb();
  const administration = new SqliteAdministrationRepository(database.db);
  const sessions = new SqliteUserSessionRepository(database.db);
  const safety = new SqliteSafetyRepository(database.db);
  const transactions = new SqliteTransactionManager(database.db);
  const policyChanges: string[] = [];
  const resetMediaUrls: string[] = [];
  const service = new AdministrationService({
    administration,
    sessions,
    safety,
    transactions,
    now: () => Date.UTC(2026, 0, 1),
    onRoleChanged: (userId) => policyChanges.push(userId),
    onMediaReset: (url) => {
      resetMediaUrls.push(url);
      return Promise.resolve();
    },
  });
  const settings = new SettingsService(administration, service.permissions, {
    upload: 25 * 1024 * 1024,
    avatar: 5 * 1024 * 1024,
    cover: 5 * 1024 * 1024,
  });
  const runtime = new RuntimePolicy(administration, settings);
  function addUser(id: string, role: SystemRole = "user"): void {
    database.db.prepare(
      `INSERT INTO users
       (id,username,display_name,email,password_hash,email_verified_at,system_role)
       VALUES (?,?,?,?,?,'2026-01-01T00:00:00.000Z',?)`,
    ).run(id, id, id.toUpperCase(), `${id}@example.com`, "hash", role);
  }
  return {
    ...database,
    administration,
    sessions,
    safety,
    service,
    settings,
    runtime,
    addUser,
    policyChanges,
    resetMediaUrls,
  };
}

Deno.test("administration permissions are exact, persisted, and client role claims have no authority", async () => {
  const h = await harness();
  try {
    h.addUser("user");
    h.addUser("moderator", "moderator");
    h.addUser("admin", "admin");
    h.addUser("owner", "owner");
    assertEquals(ROLE_PERMISSIONS.user, []);
    assertEquals(ROLE_PERMISSIONS.moderator.includes("admin.users.view"), false);
    assertEquals(ROLE_PERMISSIONS.admin.includes("owner.admins.assign"), false);
    assertEquals(ROLE_PERMISSIONS.owner.includes("owner.ownership.transfer"), true);
    assertThrows(() => h.service.listUsers("moderator", {}, null, 25), PermissionDeniedError);
    assertEquals(h.service.listUsers("admin", {}, null, 25).items.length, 4);

    const tokenService = new TokenService({
      secret: "admin-route-test",
      accessTokenTtlSeconds: 900,
    });
    const route = new UpdateAdminUserRoute(
      h.service,
      tokenService,
      new JsonCodec(),
      h.runtime,
    );
    const token = await tokenService.signAccessToken("admin", "admin", "trusted-session");
    await assertRejects(
      () =>
        route.handle({
          request: new Request("http://localhost/api/admin/users/user", {
            method: "PATCH",
            headers: { authorization: `Bearer ${token}` },
            body: JSON.stringify({ expectedVersion: 1, role: "owner" }),
          }),
          params: { userId: "user" },
          clientIp: "127.0.0.1",
        }),
      ValidationError,
    );
    assertEquals(h.administration.getRole("user"), "user");
  } finally {
    await h.cleanup();
  }
});

Deno.test("user administration returns safe DTOs, enforces hierarchy and CAS, and revokes sessions", async () => {
  const h = await harness();
  try {
    h.addUser("owner", "owner");
    h.addUser("admin", "admin");
    h.addUser("target");
    h.sessions.create({
      id: "session",
      userId: "target",
      refreshTokenHash: "refresh-secret",
      deviceLabel: null,
      remembered: false,
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    const listed = h.service.listUsers("admin", { search: "target" }, null, 25).items[0]!;
    assertEquals(Object.hasOwn(listed, "passwordHash"), false);
    assertEquals(Object.hasOwn(listed, "refreshTokenHash"), false);
    const updated = h.service.updateUser("admin", "target", listed.version, {
      displayName: "Changed",
      disabled: true,
    });
    assertEquals(updated.displayName, "Changed");
    assertEquals(h.sessions.findById("session")?.revokedAt !== null, true);
    assertEquals(h.policyChanges, ["target"]);
    assertThrows(
      () => h.service.updateUser("admin", "target", listed.version, { bio: "stale" }),
      UserUpdateConflictError,
    );
    assertThrows(
      () => h.service.updateUser("admin", "owner", 1, { displayName: "No" }),
      RoleHierarchyViolationError,
    );
    assertThrows(() => h.runtime.requireAccountAccess("target"), AccountDisabledError);

    h.addUser("security-target");
    h.sessions.create({
      id: "security-session",
      userId: "security-target",
      refreshTokenHash: "security-refresh",
      deviceLabel: null,
      remembered: false,
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    h.service.forcePasswordReset("admin", "security-target");
    assertEquals(h.service.getUser("admin", "security-target").mustResetPassword, true);
    assertEquals(h.sessions.findById("security-session")?.revokedAt !== null, true);

    h.db.prepare("UPDATE users SET avatar_url='/media/avatar',cover_url='/media/cover' WHERE id=?")
      .run("security-target");
    await h.service.resetMedia("admin", "security-target", "avatar");
    await h.service.resetMedia("admin", "security-target", "cover");
    assertEquals(h.resetMediaUrls, ["/media/avatar", "/media/cover"]);
    const media = h.service.getUser("admin", "security-target");
    assertEquals(media.avatarUrl, null);
    assertEquals(media.coverUrl, null);
  } finally {
    await h.cleanup();
  }
});

Deno.test("role transitions preserve hierarchy, protect the final owner, and transfer atomically", async () => {
  const h = await harness();
  try {
    h.addUser("owner", "owner");
    h.addUser("admin", "admin");
    h.addUser("candidate");
    h.service.setRole("admin", "candidate", "user", "moderator");
    assertEquals(h.administration.getRole("candidate"), "moderator");
    assertThrows(
      () => h.service.setRole("admin", "candidate", "moderator", "admin"),
      PermissionDeniedError,
    );
    assertThrows(
      () => h.service.setRole("admin", "candidate", "moderator", "owner"),
      FinalOwnerProtectedError,
    );
    assertThrows(
      () => h.service.setRole("owner", "candidate", "user", "admin"),
      RoleConflictError,
    );
    h.service.setRole("owner", "candidate", "moderator", "admin");
    assertEquals(h.service.listUsers("candidate", {}, null, 1).items.length, 1);
    assertThrows(
      () => h.service.setRole("admin", "owner", "owner", "user"),
      FinalOwnerProtectedError,
    );
    assertThrows(
      () => h.db.prepare("UPDATE users SET system_role='admin' WHERE id='owner'").run(),
    );

    h.service.transferOwnership("owner", "admin", "owner", "admin");
    assertEquals(h.administration.getRole("owner"), "admin");
    assertEquals(h.administration.getRole("admin"), "owner");
    assertEquals(h.administration.countOwners(), 1);
    assertThrows(
      () => h.service.transferOwnership("owner", "admin", "owner", "admin"),
      PermissionDeniedError,
    );
    assertEquals(
      h.safety.listAudit({ actionCode: "owner.transferred" }, null, 10).items.length,
      1,
    );
  } finally {
    await h.cleanup();
  }
});

Deno.test("channel administration is channel-only, versioned, archival, and audited", async () => {
  const h = await harness();
  try {
    h.addUser("admin", "admin");
    const channel = h.service.createChannel("admin", {
      slug: "operations",
      name: "Operations",
      description: "Ops",
      sortOrder: 5,
    });
    const updated = h.service.updateChannel("admin", channel.id, channel.version, {
      name: "Operations Updated",
    });
    const defaultChannel = h.administration.findAdminChannel(
      "11111111-1111-4111-8111-111111111111",
    )!;
    assertThrows(
      () =>
        h.service.setChannelState(
          "admin",
          defaultChannel.id,
          defaultChannel.version,
          "archived",
        ),
      SettingValidationError,
    );
    assertThrows(
      () => h.service.updateChannel("admin", channel.id, channel.version, { name: "Stale" }),
      ChannelUpdateConflictError,
    );
    const archived = h.service.setChannelState("admin", channel.id, updated.version, "archived");
    assertEquals(archived.state, "archived");
    assertThrows(() => h.runtime.requireChannelMutation(channel.id), MaintenanceModeError);
    const restored = h.service.setChannelState("admin", channel.id, archived.version, "active");
    assertEquals(restored.state, "active");
    const firstPage = h.service.listChannels("admin", "active", null, 2);
    const secondPage = h.service.listChannels("admin", "active", firstPage.nextCursor, 2);
    assertEquals(firstPage.nextCursor !== null, true);
    assertEquals(
      firstPage.items.some((item) => secondPage.items.some((next) => next.id === item.id)),
      false,
    );
    h.db.prepare(
      "INSERT INTO conversations (id,type,name,owner_id,is_public) VALUES ('group','group','Group','admin',0)",
    ).run();
    assertEquals(h.administration.findAdminChannel("group"), null);
    assertEquals(
      h.safety.listAudit({ targetType: "channel", targetId: channel.id }, null, 10).items.length,
      4,
    );
  } finally {
    await h.cleanup();
  }
});

Deno.test("settings reject secrets, enforce types/default channels, CAS, and runtime policies", async () => {
  const h = await harness();
  try {
    h.addUser("admin", "admin");
    h.addUser("owner", "owner");
    h.addUser("user");
    assertThrows(
      () => h.service.updateSetting("owner", h.settings, "jwt_secret", 1, "secret"),
      SettingNotSupportedError,
    );
    assertThrows(
      () => h.service.updateSetting("admin", h.settings, "max_message_length", 1, 99),
      SettingValidationError,
    );
    assertThrows(
      () => h.service.updateSetting("admin", h.settings, "default_channel_id", 1, "missing"),
      SettingValidationError,
    );
    const registration = h.service.updateSetting(
      "admin",
      h.settings,
      "registration_enabled",
      1,
      false,
    );
    assertEquals(registration.version, 2);
    assertThrows(() => h.runtime.requireRegistration(), RegistrationDisabledError);
    assertThrows(
      () => h.service.updateSetting("admin", h.settings, "registration_enabled", 1, true),
      SettingUpdateConflictError,
    );
    h.service.updateSetting("admin", h.settings, "maintenance_mode", 1, true);
    assertThrows(() => h.runtime.requireMutation("user"), MaintenanceModeError);
    assertThrows(() => h.runtime.requireMutation("admin"), MaintenanceModeError);
    let dispatched = false;
    const registry = new WebSocketHandlerRegistry(undefined, h.runtime);
    registry.register({
      event: "profile.update",
      handle() {
        dispatched = true;
        return {};
      },
    });
    const response = await registry.dispatch(
      { userId: "user", connectionId: "connection" },
      { id: "request", event: "profile.update", data: {} },
      createLogger("error", "administration-test"),
    );
    assertEquals(response.error?.code, "MAINTENANCE_MODE");
    assertEquals(dispatched, false);
    assertThrows(
      () => h.service.updateSetting("admin", h.settings, "email_verification_required", 1, false),
      PermissionDeniedError,
    );
    assertEquals(
      h.service.updateSetting("owner", h.settings, "email_verification_required", 1, false).value,
      false,
    );
    assertThrows(() =>
      h.db.prepare(
        "INSERT INTO system_settings (key,value_json,value_type) VALUES ('resend_api_key','\"x\"','string')",
      ).run()
    );
    assertEquals(
      h.safety.listAudit({ actionCode: "admin.registration_policy.updated" }, null, 10).items
        .length,
      1,
    );
    assertEquals(
      h.safety.listAudit({ actionCode: "admin.maintenance_mode.updated" }, null, 10).items.length,
      1,
    );
    h.db.exec(
      `CREATE TRIGGER reject_setting_audit BEFORE INSERT ON security_audit_events
       WHEN NEW.action_code='admin.setting.updated'
       BEGIN SELECT RAISE(ABORT,'audit unavailable'); END`,
    );
    assertThrows(() => h.service.updateSetting("admin", h.settings, "max_message_length", 1, 3000));
    assertEquals(h.administration.findSetting("max_message_length")?.version, 1);
  } finally {
    await h.cleanup();
  }
});

Deno.test("operator capabilities are server-derived and administration mutations append bounded audit", async () => {
  const h = await harness();
  try {
    h.addUser("user");
    h.addUser("moderator", "moderator");
    h.addUser("admin", "admin");
    h.addUser("owner", "owner");
    assertEquals(h.service.operator("user").areas, {
      moderation: false,
      administration: false,
      owner: false,
    });
    assertEquals(h.service.operator("moderator").areas, {
      moderation: true,
      administration: false,
      owner: false,
    });
    assertEquals(h.service.operator("admin").areas, {
      moderation: true,
      administration: true,
      owner: false,
    });
    assertEquals(h.service.operator("owner").areas, {
      moderation: true,
      administration: true,
      owner: true,
    });
    const operator = h.service.operator("owner") as unknown as Record<string, unknown>;
    assertEquals(Object.hasOwn(operator, "passwordHash"), false);
    const target = h.service.getUser("admin", "user");
    h.service.updateUser("admin", "user", target.version, { bio: "safe" });
    const event = h.safety.listAudit({ actionCode: "admin.user.updated" }, null, 10).items[0]!;
    assertEquals(event.actorType, "admin");
    assertEquals(event.metadata.fields, "bio");
    h.addUser("rollback-target");
    h.db.exec(
      `CREATE TRIGGER reject_user_audit BEFORE INSERT ON security_audit_events
       WHEN NEW.action_code='admin.user.updated'
       BEGIN SELECT RAISE(ABORT,'audit unavailable'); END`,
    );
    assertThrows(() =>
      h.service.updateUser("admin", "rollback-target", 1, { displayName: "Must Roll Back" })
    );
    assertEquals(h.service.getUser("admin", "rollback-target").displayName, "ROLLBACK-TARGET");
  } finally {
    await h.cleanup();
  }
});
