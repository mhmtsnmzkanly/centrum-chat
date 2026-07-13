import type { Permission, SystemRole } from "./administration.entity.ts";
import type { AdministrationRepository } from "./administrationRepository.port.ts";
import { PermissionDeniedError } from "./administrationErrors.ts";

const MODERATOR: readonly Permission[] = [
  "moderation.reports.view",
  "moderation.reports.assign",
  "moderation.reports.transition",
  "moderation.context.view",
  "moderation.sanctions.message_mute",
  "moderation.sanctions.interaction_restriction",
  "moderation.sanctions.revoke",
];
const ADMIN: readonly Permission[] = [
  ...MODERATOR,
  "moderation.sanctions.account_suspension",
  "admin.users.view",
  "admin.users.edit",
  "admin.users.sessions.revoke",
  "admin.users.force_password_reset",
  "admin.users.reset_media",
  "admin.channels.view",
  "admin.channels.create",
  "admin.channels.update",
  "admin.channels.archive",
  "admin.channels.restore",
  "admin.roles.view",
  "admin.roles.assign_moderator",
  "admin.roles.revoke_moderator",
  "admin.settings.view",
  "admin.settings.update",
  "admin.feature_flags.update",
  "admin.registration_policy.update",
  "admin.audit.view",
];
const OWNER: readonly Permission[] = [
  ...ADMIN,
  "owner.admins.assign",
  "owner.admins.revoke",
  "owner.ownership.transfer",
  "owner.security_settings.update",
];

export const ROLE_PERMISSIONS: Readonly<Record<SystemRole, readonly Permission[]>> = {
  user: [],
  moderator: MODERATOR,
  admin: ADMIN,
  owner: OWNER,
};

export const ROLE_RANK: Readonly<Record<SystemRole, number>> = {
  user: 0,
  moderator: 1,
  admin: 2,
  owner: 3,
};

export class AdministrationPermissionService {
  constructor(private readonly repository: AdministrationRepository) {}

  role(userId: string): SystemRole | null {
    return this.repository.getRole(userId);
  }

  permissions(userId: string): readonly Permission[] {
    const role = this.role(userId);
    return role ? ROLE_PERMISSIONS[role] : [];
  }

  require(userId: string, permission: Permission): SystemRole {
    const role = this.role(userId);
    if (!role || !ROLE_PERMISSIONS[role].includes(permission)) {
      throw new PermissionDeniedError("This operation is not permitted.");
    }
    return role;
  }
}
