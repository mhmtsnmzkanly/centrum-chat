import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { NotificationService } from "../../../../domain/notifications/notificationService.ts";
import { asRecord, optionalBoolean } from "../../../../shared/validation/validator.ts";
import { ValidationError } from "../../../../shared/errors/validationError.ts";

/** Upper bound on ids per request so a client cannot submit an unbounded
 * payload; larger cleanups should use `{ all: true }`. */
const MAX_DELETE_IDS = 100;

/** docs/03-websocket-events.md "Module: Notifications" — `notification.delete`.
 * Accepts either `{ ids: string[] }` or `{ all: true }`. Only the caller's own
 * notifications are affected; foreign or unknown ids are silently skipped. */
export class DeleteNotificationsHandler implements EventHandler {
  readonly event = "notification.delete";

  constructor(private readonly notificationService: NotificationService) {}

  handle(ctx: HandlerContext, data: unknown): { deletedCount: number } {
    const body = asRecord(data, "notification.delete data");
    const all = optionalBoolean(body, "all");
    if (all === true) {
      return { deletedCount: this.notificationService.deleteAll(ctx.userId) };
    }

    const rawIds = body["ids"];
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      throw new ValidationError('Provide either a non-empty "ids" array or "all: true".');
    }
    if (rawIds.length > MAX_DELETE_IDS) {
      throw new ValidationError(
        `"ids" may contain at most ${MAX_DELETE_IDS} entries; use "all: true" for larger cleanups.`,
      );
    }
    if (!rawIds.every((id) => typeof id === "string" && id.length > 0)) {
      throw new ValidationError('"ids" must contain only non-empty strings.');
    }

    return { deletedCount: this.notificationService.deleteByIds(ctx.userId, rawIds) };
  }
}
