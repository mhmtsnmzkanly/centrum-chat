import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";

/** Cheap process liveness probe: no DB query, no auth, just "can the server answer HTTP". */
export class HealthLiveRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/health/live";

  constructor(private readonly codec: ProtocolCodec) {}

  handle(_ctx: HttpRequestContext): Response {
    return successResponse(this.codec, { status: "ok" });
  }
}
