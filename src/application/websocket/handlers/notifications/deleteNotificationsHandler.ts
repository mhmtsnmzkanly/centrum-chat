import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { NotificationService } from "../../../../domain/notifications/notificationService.ts";
import { asRecord } from "../../../../shared/validation/validator.ts";
import { ValidationError } from "../../../../shared/errors/validationError.ts";

/** Upper bound on ids per request so a client cannot submit an unbounded
 * payload; larger cleanups should use `{ all: true }`. */
const MAX_DELETE_IDS = 100;

/** docs/03-websocket-events.md "Module: Notifications" — `notification.delete`.
 * Accepts exactly one of `{ ids: string[] }` or `{ all: true }`. Only the caller's own
 * notifications are affected; foreign or unknown ids are silently skipped. */
export class DeleteNotificationsHandler implements EventHandler {
  readonly event = "notification.delete";

  constructor(private readonly notificationService: NotificationService) {}

  handle(ctx: HandlerContext, data: unknown): { deletedCount: number } {
    const body = asRecord(data, "notification.delete data");

    const hasAll = Object.hasOwn(body, "all");
    const hasIds = Object.hasOwn(body, "ids");

    if (hasAll && hasIds) {
      throw new ValidationError('Provide either "ids" or "all", not both.');
    }
    if (!hasAll && !hasIds) {
      throw new ValidationError('Provide either "ids" or "all".');
    }

    if (hasAll) {
      const all = body["all"];
      if (all !== true) {
        throw new ValidationError('"all" must be exactly true.');
      }
      return { deletedCount: this.notificationService.deleteAll(ctx.userId) };
    }

    // Now hasIds must be true
    const rawIds = body["ids"];
    if (!Array.isArray(rawIds)) {
      throw new ValidationError('"ids" must be an array.');
    }
    if (rawIds.length === 0) {
      throw new ValidationError('"ids" array must not be empty.');
    }
    if (rawIds.length > MAX_DELETE_IDS) {
      throw new ValidationError(
        `"ids" may contain at most ${MAX_DELETE_IDS} entries; use "all: true" for larger cleanups.`,
      );
    }

    for (let i = 0; i < rawIds.length; i++) {
      const id = rawIds[i];
      if (typeof id !== "string") {
        throw new ValidationError(`"ids[${i}]" must be a string.`);
      }
      if (id.trim().length === 0) {
        throw new ValidationError(`"ids[${i}]" must not be empty or whitespace-only.`);
      }
    }

    return { deletedCount: this.notificationService.deleteByIds(ctx.userId, rawIds) };
  }
}
