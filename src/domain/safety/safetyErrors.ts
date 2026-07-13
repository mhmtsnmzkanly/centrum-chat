import { DomainError } from "../../shared/errors/domainError.ts";

export class BlockedInteractionError extends DomainError {
  readonly code = "BLOCKED_INTERACTION";
}
export class MessageMutedError extends DomainError {
  readonly code = "MESSAGE_MUTED";
}
export class InteractionRestrictedError extends DomainError {
  readonly code = "INTERACTION_RESTRICTED";
}
export class AccountSuspendedError extends DomainError {
  readonly code = "ACCOUNT_SUSPENDED";
}
export class CaptchaRequiredError extends DomainError {
  readonly code = "CAPTCHA_REQUIRED";
}
