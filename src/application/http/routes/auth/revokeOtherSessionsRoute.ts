import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";

export class RevokeOtherSessionsRoute implements RouteHandler {
  readonly method = "DELETE" as const;
  readonly path = "/api/auth/sessions/others";

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
        `auth.sessions.revoke-others:${auth.userId}`,
        "Too many session revocation attempts. Try again later.",
      );
    }
    return successResponse(
      this.codec,
      { revokedCount: this.authService.revokeOtherSessions(auth.userId, auth.sessionId) },
      200,
    );
  }
}
