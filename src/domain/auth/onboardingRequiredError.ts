import { DomainError } from "../../shared/errors/domainError.ts";

export class OnboardingRequiredError extends DomainError {
  readonly code = "ONBOARDING_REQUIRED";
}
