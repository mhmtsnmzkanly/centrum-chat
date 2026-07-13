import type { EventHandler, HandlerContext } from "../../eventHandler.ts";

/** Application-level heartbeat ack; the transport loop already records activity. */
export class SystemPongHandler
  implements EventHandler<Record<string, never>, Record<string, never>> {
  readonly event = "system.pong";

  handle(_ctx: HandlerContext, _data: Record<string, never>): Record<string, never> {
    return {};
  }
}
