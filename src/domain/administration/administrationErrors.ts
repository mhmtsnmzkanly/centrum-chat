import { DomainError } from "../../shared/errors/domainError.ts";

export class PermissionDeniedError extends DomainError {
  readonly code = "PERMISSION_DENIED";
}
export class OwnerRequiredError extends DomainError {
  readonly code = "OWNER_REQUIRED";
}
export class FinalOwnerProtectedError extends DomainError {
  readonly code = "FINAL_OWNER_PROTECTED";
}
export class RoleHierarchyViolationError extends DomainError {
  readonly code = "ROLE_HIERARCHY_VIOLATION";
}
export class RoleConflictError extends DomainError {
  readonly code = "ROLE_CONFLICT";
}
export class UserNotFoundAdminError extends DomainError {
  readonly code = "USER_NOT_FOUND";
}
export class UserUpdateConflictError extends DomainError {
  readonly code = "USER_UPDATE_CONFLICT";
}
export class ForcePasswordResetRequiredError extends DomainError {
  readonly code = "FORCE_PASSWORD_RESET_REQUIRED";
}
export class AccountDisabledError extends DomainError {
  readonly code = "ACCOUNT_DISABLED";
}
export class ChannelNotFoundError extends DomainError {
  readonly code = "CHANNEL_NOT_FOUND";
}
export class ChannelAlreadyArchivedError extends DomainError {
  readonly code = "CHANNEL_ALREADY_ARCHIVED";
}
export class ChannelNotArchivedError extends DomainError {
  readonly code = "CHANNEL_NOT_ARCHIVED";
}
export class ChannelUpdateConflictError extends DomainError {
  readonly code = "CHANNEL_UPDATE_CONFLICT";
}
export class SettingNotSupportedError extends DomainError {
  readonly code = "SETTING_NOT_SUPPORTED";
}
export class SettingValidationError extends DomainError {
  readonly code = "SETTING_VALIDATION_FAILED";
}
export class SettingUpdateConflictError extends DomainError {
  readonly code = "SETTING_UPDATE_CONFLICT";
}
export class RegistrationDisabledError extends DomainError {
  readonly code = "REGISTRATION_DISABLED";
}
export class MaintenanceModeError extends DomainError {
  readonly code = "MAINTENANCE_MODE";
}
