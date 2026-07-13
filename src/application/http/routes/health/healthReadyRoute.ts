import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { errorResponse, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { Db } from "../../../../storage/db.ts";
import type { Logger } from "../../../../shared/logging/logger.ts";

/** Readiness probe: runtime dependency check for SQLite after the server has already booted. */
export class HealthReadyRoute implements RouteHandler {
  readonly method = "GET" as const;

  constructor(
    readonly path: "/health" | "/health/ready",
    private readonly db: Db,
    private readonly codec: ProtocolCodec,
    private readonly logger: Logger,
  ) {}

  handle(_ctx: HttpRequestContext): Response {
    try {
      this.db.prepare("SELECT 1").get();
      return successResponse(this.codec, { status: "ok" });
    } catch (error) {
      this.logger.error("readiness check failed", { error });
      return errorResponse(
        this.codec,
        { code: "UNAVAILABLE", message: "Service not ready." },
        503,
      );
    }
  }
}
