/** Base class for all errors the domain/application layers intentionally throw.
 * Anything not extending this is treated as an unexpected bug by the error boundary
 * and mapped to a generic INTERNAL_ERROR (see errorBoundary.ts). */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}
