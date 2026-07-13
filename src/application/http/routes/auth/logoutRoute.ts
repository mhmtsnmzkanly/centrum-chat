import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";

/** docs/04-http-api.md "POST /api/auth/logout" — revokes the given refresh token. Does
 * not force-close the caller's WS connections since a user may have other active
 * sessions/devices. */
export class LogoutRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/logout";

  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly codec: ProtocolCodec,
    private readonly rateLimiter?: RateLimiter,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await verifyAccessToken(
      this.tokenService,
      extractBearerToken(ctx.request.headers.get("authorization")),
    );
    if (this.rateLimiter) {
      requireHttpRateLimit(
        this.rateLimiter,
        `auth.logout:${auth.userId}`,
        "Too many logout attempts. Try again later.",
      );
    }

    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const refreshToken = requireString(body, "refreshToken");

    await this.authService.logout(auth.userId, refreshToken);
    return successResponse(this.codec, {}, 200);
  }
}
