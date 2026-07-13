import { DomainError } from "./domainError.ts";

export class UnauthorizedError extends DomainError {
  readonly code = "UNAUTHORIZED";
}
