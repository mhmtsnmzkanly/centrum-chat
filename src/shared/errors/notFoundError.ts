import { DomainError } from "./domainError.ts";

export class NotFoundError extends DomainError {
  readonly code = "NOT_FOUND";
}
