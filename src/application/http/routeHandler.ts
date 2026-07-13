export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequestContext {
  readonly request: Request;
  readonly params: Readonly<Record<string, string>>;
  /** The connecting socket's address — used for IP-scoped rate limiting (e.g.
   * `POST /api/auth/login`, docs/04-http-api.md), since there's no authenticated userId
   * yet at that point. */
  readonly clientIp: string;
}

/** One route handler per HTTP endpoint, mirroring the WS EventHandler pattern (Phase 1) —
 * no monolithic router/switch inspects the path itself outside RouteRegistry. */
export interface RouteHandler {
  readonly method: HttpMethod;
  /** Path pattern with `:name` segments, e.g. "/media/:id". */
  readonly path: string;
  handle(ctx: HttpRequestContext): Promise<Response> | Response;
}
