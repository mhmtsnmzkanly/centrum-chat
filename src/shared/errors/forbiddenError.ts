import { DomainError } from "./domainError.ts";

export class ForbiddenError extends DomainError {
  readonly code = "FORBIDDEN";
}
