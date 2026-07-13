import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";

/** docs/04-http-api.md "POST /api/auth/refresh" — rotates the refresh token on each use. */
export class RefreshRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/refresh";

  constructor(
    private readonly authService: AuthService,
    private readonly codec: ProtocolCodec,
    private readonly rateLimiter?: RateLimiter,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    if (this.rateLimiter) {
      requireHttpRateLimit(
        this.rateLimiter,
        `auth.refresh:${ctx.clientIp}`,
        "Too many refresh attempts. Try again later.",
      );
    }
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const refreshToken = requireString(body, "refreshToken");

    const result = await this.authService.refresh(refreshToken);
    return successResponse(
      this.codec,
      { accessToken: result.accessToken, refreshToken: result.refreshToken },
      200,
    );
  }
}
