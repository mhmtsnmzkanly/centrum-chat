import { DomainError } from "../../shared/errors/domainError.ts";

export class EmailVerificationRequiredError extends DomainError {
  readonly code = "EMAIL_VERIFICATION_REQUIRED";
}
