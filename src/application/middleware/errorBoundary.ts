import { DomainError } from "../../shared/errors/domainError.ts";
import type { ErrorPayload } from "../../shared/errors/errorPayload.ts";
import type { Logger } from "../../shared/logging/logger.ts";

const HTTP_STATUS_BY_CODE: Readonly<Record<string, number>> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  EMAIL_VERIFICATION_REQUIRED: 403,
  ONBOARDING_REQUIRED: 403,
  BLOCKED_INTERACTION: 403,
  MESSAGE_MUTED: 403,
  INTERACTION_RESTRICTED: 403,
  ACCOUNT_SUSPENDED: 403,
  CAPTCHA_REQUIRED: 403,
  PERMISSION_DENIED: 403,
  OWNER_REQUIRED: 403,
  FINAL_OWNER_PROTECTED: 409,
  ROLE_HIERARCHY_VIOLATION: 403,
  ROLE_CONFLICT: 409,
  USER_NOT_FOUND: 404,
  USER_UPDATE_CONFLICT: 409,
  FORCE_PASSWORD_RESET_REQUIRED: 403,
  ACCOUNT_DISABLED: 403,
  CHANNEL_NOT_FOUND: 404,
  CHANNEL_ALREADY_ARCHIVED: 409,
  CHANNEL_NOT_ARCHIVED: 409,
  CHANNEL_UPDATE_CONFLICT: 409,
  SETTING_NOT_SUPPORTED: 400,
  SETTING_VALIDATION_FAILED: 400,
  SETTING_UPDATE_CONFLICT: 409,
  REGISTRATION_DISABLED: 403,
  MAINTENANCE_MODE: 503,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export interface ErrorTranslation {
  readonly payload: ErrorPayload;
  readonly httpStatus: number;
}

/** Single error-translation boundary (architecture doc §7): every handler dispatch
 * (HTTP and WS) funnels thrown errors through this function. Known DomainError
 * subclasses map to their declared code; anything else is an unexpected bug, logged
 * with full detail server-side and reduced to a generic INTERNAL_ERROR for the client
 * so a raw exception never reaches a socket or HTTP response. */
export function translateError(error: unknown, logger: Logger): ErrorTranslation {
  if (error instanceof DomainError) {
    return {
      payload: { code: error.code, message: error.message, details: error.details },
      httpStatus: HTTP_STATUS_BY_CODE[error.code] ?? 500,
    };
  }
  logger.error("unexpected error", { error });
  return {
    payload: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." },
    httpStatus: 500,
  };
}
