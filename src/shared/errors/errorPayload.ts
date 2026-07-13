/** Shape every error takes once it crosses the transport boundary, over HTTP or WS.
 * See docs/03-websocket-events.md "Standard error codes" for the closed set of `code` values. */
export interface ErrorPayload {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}
