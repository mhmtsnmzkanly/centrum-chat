import { DomainError } from "./domainError.ts";

export class RateLimitedError extends DomainError {
  readonly code = "RATE_LIMITED";
}
