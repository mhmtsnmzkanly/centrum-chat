import { DomainError } from "./domainError.ts";

export class ValidationError extends DomainError {
  readonly code = "VALIDATION_ERROR";
}
