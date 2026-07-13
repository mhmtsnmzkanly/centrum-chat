import type { UserSessionRepository } from "../auth/userSessionRepository.port.ts";
import type { SafetyRepository } from "../safety/safetyRepository.port.ts";
import type { TransactionManager } from "../../shared/transactions/transactionManager.ts";
import type { SystemRole } from "./administration.entity.ts";
import type { SettingsService } from "./settingsService.ts";
import type {
  AdministrationRepository,
  AdminUserFilters,
} from "./administrationRepository.port.ts";
import { AdministrationPermissionService, ROLE_RANK } from "./permissionRegistry.ts";
import {
  ChannelAlreadyArchivedError,
  ChannelNotArchivedError,
  ChannelNotFoundError,
  ChannelUpdateConflictError,
  FinalOwnerProtectedError,
  RoleConflictError,
  RoleHierarchyViolationError,
  SettingValidationError,
  UserNotFoundAdminError,
  UserUpdateConflictError,
} from "./administrationErrors.ts";
import { generateId } from "../../shared/id.ts";

export class AdministrationService {
  readonly permissions: AdministrationPermissionService;
  private readonly now: () => number;

  constructor(
    private readonly options: {
      readonly administration: AdministrationRepository;
      readonly sessions: UserSessionRepository;
      readonly safety: SafetyRepository;
      readonly transactions: TransactionManager;
      readonly now?: () => number;
      readonly onRoleChanged?: (userId: string) => void;
      readonly onMediaReset?: (mediaUrl: string) => Promise<void>;
    },
  ) {
    this.permissions = new AdministrationPermissionService(options.administration);
    this.now = options.now ?? (() => Date.now());
  }

  operator(actorId: string) {
    const role = this.options.administration.getRole(actorId);
    const user = this.options.administration.findAdminUser(actorId, this.nowIso());
    if (!role || !user) throw new UserNotFoundAdminError("Operator not found.");
    const permissions = this.permissions.permissions(actorId);
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      role,
      permissions,
      areas: {
        moderation: permissions.some((item) => item.startsWith("moderation.")),
        administration: permissions.some((item) => item.startsWith("admin.")),
        owner: role === "owner",
      },
    };
  }

  listUsers(actorId: string, filters: AdminUserFilters, cursor: string | null, limit: number) {
    this.permissions.require(actorId, "admin.users.view");
    return this.options.administration.listUsers(filters, cursor, limit, this.nowIso());
  }
  getUser(actorId: string, userId: string) {
    this.permissions.require(actorId, "admin.users.view");
    const user = this.options.administration.findAdminUser(userId, this.nowIso());
    if (!user) throw new UserNotFoundAdminError("User not found.");
    return user;
  }
  updateUser(
    actorId: string,
    userId: string,
    expectedVersion: number,
    patch: { displayName?: string; bio?: string; disabled?: boolean },
  ) {
    const actorRole = this.permissions.require(actorId, "admin.users.edit");
    const target = this.requireManageable(actorId, actorRole, userId);
    if (patch.disabled === true && target.role === "owner") {
      throw new FinalOwnerProtectedError("An owner cannot be disabled.");
    }
    const dbPatch = {
      ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
      ...(patch.bio === undefined ? {} : { bio: patch.bio }),
      ...(patch.disabled === undefined
        ? {}
        : { disabledAt: patch.disabled ? this.nowIso() : null }),
    };
    const updated = this.options.transactions.run(() => {
      const result = this.options.administration.updateUser(userId, expectedVersion, dbPatch);
      if (!result) throw new UserUpdateConflictError("The user changed concurrently.");
      if (patch.disabled === true) {
        this.options.sessions.revokeAllForUser(userId, this.nowIso());
      }
      this.audit(actorId, actorRole, "admin.user.updated", "user", userId, {
        fields: Object.keys(patch).sort().join(","),
      });
      return result;
    });
    if (patch.disabled === true) this.options.onRoleChanged?.(userId);
    return updated;
  }
  revokeSessions(actorId: string, userId: string): number {
    const role = this.permissions.require(actorId, "admin.users.sessions.revoke");
    this.requireManageable(actorId, role, userId);
    return this.options.transactions.run(() => {
      const count = this.options.sessions.revokeAllForUser(userId, this.nowIso());
      this.audit(actorId, role, "admin.user.sessions_revoked", "user", userId, { count });
      return count;
    });
  }
  forcePasswordReset(actorId: string, userId: string): void {
    const role = this.permissions.require(actorId, "admin.users.force_password_reset");
    this.requireManageable(actorId, role, userId);
    this.options.transactions.run(() => {
      if (!this.options.administration.setMustResetPassword(userId, true)) {
        throw new UserNotFoundAdminError("User not found.");
      }
      this.options.sessions.revokeAllForUser(userId, this.nowIso());
      this.audit(actorId, role, "admin.user.password_reset_forced", "user", userId, {});
    });
    this.options.onRoleChanged?.(userId);
  }
  async resetMedia(actorId: string, userId: string, kind: "avatar" | "cover"): Promise<void> {
    const role = this.permissions.require(actorId, "admin.users.reset_media");
    this.requireManageable(actorId, role, userId);
    const previousUrl = this.options.transactions.run(() => {
      const value = kind === "avatar"
        ? this.options.administration.resetAvatar(userId)
        : this.options.administration.resetCover(userId);
      if (value === undefined) throw new UserNotFoundAdminError("User not found.");
      this.audit(actorId, role, `admin.user.${kind}_reset`, "user", userId, {});
      return value;
    });
    if (previousUrl) await this.options.onMediaReset?.(previousUrl);
  }

  setRole(actorId: string, targetId: string, expected: SystemRole, next: SystemRole): void {
    const actorRole = this.options.administration.getRole(actorId);
    if (!actorRole) throw new RoleHierarchyViolationError("Actor role is unavailable.");
    if (next === "owner" || expected === "owner") {
      throw new FinalOwnerProtectedError("Ownership changes require atomic transfer.");
    }
    if (actorId === targetId && ROLE_RANK[next] > ROLE_RANK[actorRole]) {
      throw new RoleHierarchyViolationError("Self-promotion is not permitted.");
    }
    if (next === "moderator") {
      this.permissions.require(actorId, "admin.roles.assign_moderator");
      if (expected !== "user") {
        throw new RoleHierarchyViolationError("Invalid moderator transition.");
      }
    } else if (expected === "moderator" && next === "user") {
      this.permissions.require(actorId, "admin.roles.revoke_moderator");
    } else if (next === "admin") {
      this.permissions.require(actorId, "owner.admins.assign");
      if (expected !== "user" && expected !== "moderator") {
        throw new RoleHierarchyViolationError("Invalid admin transition.");
      }
    } else if (expected === "admin" && next === "user") {
      this.permissions.require(actorId, "owner.admins.revoke");
    } else {
      throw new RoleHierarchyViolationError("This role transition is not supported.");
    }
    if (ROLE_RANK[actorRole] <= ROLE_RANK[expected] && actorId !== targetId) {
      throw new RoleHierarchyViolationError("A lower role cannot alter an equal or higher role.");
    }
    this.options.transactions.run(() => {
      if (!this.options.administration.compareAndSetRole(targetId, expected, next)) {
        throw new RoleConflictError("The target role changed concurrently.");
      }
      this.audit(
        actorId,
        actorRole,
        ROLE_RANK[next] > ROLE_RANK[expected] ? "admin.role.assigned" : "admin.role.revoked",
        "user",
        targetId,
        { expectedRole: expected, nextRole: next },
      );
    });
    this.options.onRoleChanged?.(targetId);
  }

  transferOwnership(
    actorId: string,
    targetId: string,
    expectedActor: SystemRole,
    expectedTarget: SystemRole,
  ): void {
    const role = this.permissions.require(actorId, "owner.ownership.transfer");
    if (role !== "owner" || expectedActor !== "owner" || expectedTarget !== "admin") {
      throw new RoleHierarchyViolationError("Ownership transfers from owner to admin only.");
    }
    if (actorId === targetId) {
      throw new RoleHierarchyViolationError("Select another administrator.");
    }
    this.options.transactions.run(() => {
      const transferred = this.options.administration.transferOwnership(
        actorId,
        targetId,
        expectedActor,
        expectedTarget,
      );
      if (!transferred) throw new RoleConflictError("An ownership role changed concurrently.");
      this.audit(actorId, role, "owner.transferred", "user", targetId, {
        previousOwnerId: actorId,
      });
    });
    this.options.onRoleChanged?.(actorId);
    this.options.onRoleChanged?.(targetId);
  }

  listChannels(
    actorId: string,
    state: "active" | "archived" | null,
    cursor: string | null,
    limit: number,
  ) {
    this.permissions.require(actorId, "admin.channels.view");
    return this.options.administration.listChannels(state, cursor, limit);
  }
  createChannel(
    actorId: string,
    input: {
      slug: string;
      name: string;
      description: string;
      sortOrder: number;
    },
  ) {
    const role = this.permissions.require(actorId, "admin.channels.create");
    return this.options.transactions.run(() => {
      const channel = this.options.administration.createChannel({ id: generateId(), ...input });
      this.audit(actorId, role, "admin.channel.created", "channel", channel.id, {});
      return channel;
    });
  }
  updateChannel(
    actorId: string,
    id: string,
    expectedVersion: number,
    patch: { name?: string; description?: string; sortOrder?: number },
  ) {
    const role = this.permissions.require(actorId, "admin.channels.update");
    if (!this.options.administration.findAdminChannel(id)) {
      throw new ChannelNotFoundError("Channel not found.");
    }
    return this.options.transactions.run(() => {
      const channel = this.options.administration.updateChannel(id, expectedVersion, patch);
      if (!channel) throw new ChannelUpdateConflictError("The channel changed concurrently.");
      this.audit(actorId, role, "admin.channel.updated", "channel", id, {
        fields: Object.keys(patch).sort().join(","),
      });
      return channel;
    });
  }
  setChannelState(
    actorId: string,
    id: string,
    expectedVersion: number,
    next: "active" | "archived",
  ) {
    const permission = next === "archived" ? "admin.channels.archive" : "admin.channels.restore";
    const role = this.permissions.require(actorId, permission);
    return this.options.transactions.run(() => {
      const current = this.options.administration.findAdminChannel(id);
      if (!current) throw new ChannelNotFoundError("Channel not found.");
      if (
        next === "archived" &&
        this.options.administration.findSetting("default_channel_id")?.value === id
      ) {
        throw new SettingValidationError("The default channel cannot be archived.");
      }
      if (current.state === next) {
        if (next === "archived") {
          throw new ChannelAlreadyArchivedError("Channel is already archived.");
        }
        throw new ChannelNotArchivedError("Channel is not archived.");
      }
      const channel = this.options.administration.setChannelState(
        id,
        expectedVersion,
        current.state,
        next,
      );
      if (!channel) throw new ChannelUpdateConflictError("The channel changed concurrently.");
      this.audit(
        actorId,
        role,
        next === "archived" ? "admin.channel.archived" : "admin.channel.restored",
        "channel",
        id,
        {},
      );
      return channel;
    });
  }

  updateSetting(
    actorId: string,
    settings: SettingsService,
    key: string,
    expectedVersion: number,
    value: unknown,
  ) {
    return this.options.transactions.run(() => {
      const updated = settings.update(actorId, key, expectedVersion, value);
      const role = this.options.administration.getRole(actorId) ?? "user";
      const action = key === "registration_enabled"
        ? "admin.registration_policy.updated"
        : key === "maintenance_mode"
        ? "admin.maintenance_mode.updated"
        : "admin.setting.updated";
      this.audit(actorId, role, action, "setting", key, {
        previousVersion: expectedVersion,
        nextVersion: updated.version,
      });
      return updated;
    });
  }

  private requireManageable(actorId: string, actorRole: SystemRole, targetId: string) {
    const target = this.options.administration.findAdminUser(targetId, this.nowIso());
    if (!target) throw new UserNotFoundAdminError("User not found.");
    if (targetId !== actorId && ROLE_RANK[actorRole] <= ROLE_RANK[target.role]) {
      throw new RoleHierarchyViolationError("A lower role cannot alter an equal or higher role.");
    }
    return target;
  }
  private audit(
    actorId: string,
    actorRole: SystemRole,
    actionCode: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, string | number | boolean | null>,
  ): void {
    this.options.safety.appendAudit({
      id: generateId(),
      actorUserId: actorId,
      actorType: actorRole,
      actionCode,
      targetType,
      targetId,
      outcome: "success",
      metadata,
    });
  }
  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}
