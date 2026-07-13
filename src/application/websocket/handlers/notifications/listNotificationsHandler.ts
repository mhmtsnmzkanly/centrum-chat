import type { EventHandler, HandlerContext } from "../../eventHandler.ts";
import type { NotificationService } from "../../../../domain/notifications/notificationService.ts";
import type { NotificationSummary } from "../../../../domain/notifications/notification.entity.ts";
import { asRecord, optionalBoolean } from "../../../../shared/validation/validator.ts";

/** docs/03-websocket-events.md "Module: Notifications" — `notification.list`. */
export class ListNotificationsHandler implements EventHandler {
  readonly event = "notification.list";

  constructor(private readonly notificationService: NotificationService) {}

  handle(ctx: HandlerContext, data: unknown): { notifications: NotificationSummary[] } {
    const body = asRecord(data, "notification.list data");
    const unreadOnly = optionalBoolean(body, "unreadOnly") ?? false;
    return { notifications: this.notificationService.list(ctx.userId, unreadOnly) };
  }
}
