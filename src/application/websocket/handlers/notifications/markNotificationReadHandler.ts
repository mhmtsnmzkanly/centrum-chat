import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { NotificationService } from "../../../../domain/notifications/notificationService.ts";
import {
  asRecord,
  optionalBoolean,
  optionalString,
} from "../../../../shared/validation/validator.ts";
import { ValidationError } from "../../../../shared/errors/validationError.ts";

/** docs/03-websocket-events.md "Module: Notifications" — `notification.markRead`.
 * Accepts either `{ notificationId }` or `{ all: true }`. */
export class MarkNotificationReadHandler implements EventHandler {
  readonly event = "notification.markRead";

  constructor(private readonly notificationService: NotificationService) {}

  handle(ctx: HandlerContext, data: unknown): Record<string, never> {
    const body = asRecord(data, "notification.markRead data");
    const all = optionalBoolean(body, "all");
    if (all === true) {
      this.notificationService.markAllRead(ctx.userId);
      return {};
    }

    const notificationId = optionalString(body, "notificationId");
    if (!notificationId) {
      throw new ValidationError('Provide either "notificationId" or "all: true".');
    }
    this.notificationService.markRead(ctx.userId, notificationId);
    return {};
  }
}
