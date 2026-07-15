import type { EventHandler, HandlerContext } from "./eventHandler.ts";
import type { InboundEnvelope, OutboundResponse } from "../../protocol/envelopes.ts";
import { translateError } from "../middleware/errorBoundary.ts";
import type { Logger } from "../../shared/logging/logger.ts";
import type { SanctionPolicy } from "../../domain/safety/safetyPolicy.ts";
import type { RuntimePolicy } from "../../domain/administration/runtimePolicy.ts";
import type { AccountPolicy } from "../../domain/auth/accountPolicy.ts";

const MUTATION_EVENTS = new Set([
  "presence.update",
  "profile.update",
  "preferences.update",
  "group.create",
  "group.addMember",
  "group.removeMember",
  "group.leave",
  "dm.open",
  "message.send",
  "message.edit",
  "message.delete",
  "room.markRead",
  "reaction.toggle",
  "typing.start",
  "typing.stop",
  "notification.markRead",
  "notification.delete",
]);

/** Explicit registration list -> event:string -> handler map (architecture doc §3).
 * dispatch() is the only place that resolves an event name to a handler; the transport
 * layer's read loop calls exactly decode -> dispatch -> encode and never inspects the
 * event name itself. An event with no registered handler resolves to NOT_FOUND, same as
 * any other unknown route. */
export class WebSocketHandlerRegistry {
  private readonly handlers = new Map<string, EventHandler>();

  constructor(
    private readonly sanctionPolicy?: SanctionPolicy,
    private readonly runtimePolicy?: RuntimePolicy,
    private readonly accountPolicy?: AccountPolicy,
  ) {}

  register(handler: EventHandler): void {
    if (this.handlers.has(handler.event)) {
      throw new Error(`Duplicate WS handler registration for event "${handler.event}"`);
    }
    this.handlers.set(handler.event, handler);
  }

  async dispatch(
    ctx: HandlerContext,
    envelope: InboundEnvelope,
    logger: Logger,
  ): Promise<OutboundResponse> {
    const handler = this.handlers.get(envelope.event);
    if (!handler) {
      return {
        id: envelope.id,
        event: envelope.event,
        success: false,
        error: { code: "NOT_FOUND", message: `Unknown event: ${envelope.event}` },
      };
    }

    try {
      if (envelope.event !== "system.pong") {
        this.sanctionPolicy?.requireApplicationAccess(ctx.userId);
        this.runtimePolicy?.requireAccountAccess(ctx.userId);
        this.accountPolicy?.requireOnboardingComplete(ctx.userId);
        if (MUTATION_EVENTS.has(envelope.event)) this.runtimePolicy?.requireMutation(ctx.userId);
      }
      const data = await handler.handle(ctx, envelope.data);
      return { id: envelope.id, event: envelope.event, success: true, data };
    } catch (error) {
      // Enriches the connection-scoped logger (connectionId, userId) with which event
      // and request id were in flight, so an "unexpected error" log line is enough to
      // find the failing request without cross-referencing other lines.
      const requestLogger = logger.child("ws-dispatch", {
        event: envelope.event,
        requestId: envelope.id,
      });
      const { payload } = translateError(error, requestLogger);
      return { id: envelope.id, event: envelope.event, success: false, error: payload };
    }
  }
}
