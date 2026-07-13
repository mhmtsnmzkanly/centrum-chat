export interface HandlerContext {
  /** Always set — a connection can't exist unauthenticated (see transport/http/wsUpgrade.ts). */
  readonly userId: string;
  readonly connectionId: string;
}

/** One handler per WS event (architecture doc §3) — no switch statement ever inspects
 * the event name; WebSocketHandlerRegistry's map lookup is the only place that does. */
export interface EventHandler<TData = unknown, TResult = unknown> {
  readonly event: string;
  handle(ctx: HandlerContext, data: TData): Promise<TResult> | TResult;
}
