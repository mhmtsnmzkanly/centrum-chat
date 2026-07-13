import { DomainError } from "./domainError.ts";

export class ConflictError extends DomainError {
  readonly code = "CONFLICT";
}
