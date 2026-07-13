export type SystemRole = "user" | "moderator" | "admin" | "owner";

export const SYSTEM_ROLES: readonly SystemRole[] = ["user", "moderator", "admin", "owner"];

export type Permission =
  | "moderation.reports.view"
  | "moderation.reports.assign"
  | "moderation.reports.transition"
  | "moderation.context.view"
  | "moderation.sanctions.message_mute"
  | "moderation.sanctions.interaction_restriction"
  | "moderation.sanctions.account_suspension"
  | "moderation.sanctions.revoke"
  | "admin.users.view"
  | "admin.users.edit"
  | "admin.users.sessions.revoke"
  | "admin.users.force_password_reset"
  | "admin.users.reset_media"
  | "admin.channels.view"
  | "admin.channels.create"
  | "admin.channels.update"
  | "admin.channels.archive"
  | "admin.channels.restore"
  | "admin.roles.view"
  | "admin.roles.assign_moderator"
  | "admin.roles.revoke_moderator"
  | "admin.settings.view"
  | "admin.settings.update"
  | "admin.feature_flags.update"
  | "admin.registration_policy.update"
  | "admin.audit.view"
  | "owner.admins.assign"
  | "owner.admins.revoke"
  | "owner.ownership.transfer"
  | "owner.security_settings.update";

export interface AdminUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerifiedAt: string | null;
  readonly role: SystemRole;
  readonly bio: string;
  readonly avatarUrl: string | null;
  readonly coverUrl: string | null;
  readonly mustResetPassword: boolean;
  readonly accountDisabledAt: string | null;
  readonly suspended: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface AdminChannel {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly isPublic: boolean;
  readonly sortOrder: number;
  readonly state: "active" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export type SettingKey =
  | "registration_enabled"
  | "email_verification_required"
  | "maintenance_mode"
  | "max_message_length"
  | "max_group_members"
  | "max_upload_size_bytes"
  | "max_avatar_size_bytes"
  | "max_cover_size_bytes"
  | "allow_group_creation"
  | "allow_new_dm"
  | "default_channel_id";

export type SettingValue = boolean | number | string;

export interface SettingRecord {
  readonly key: SettingKey;
  readonly value: SettingValue;
  readonly type: "boolean" | "integer" | "string";
  readonly version: number;
  readonly updatedByUserId: string | null;
  readonly updatedAt: string;
}

export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}
