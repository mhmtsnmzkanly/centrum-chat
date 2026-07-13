import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";

/** docs/04-http-api.md "POST /api/auth/change-password" — updates user password. */
export class ChangePasswordRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/change-password";

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
        `auth.change-password:${auth.userId}`,
        "Too many password change attempts. Try again later.",
      );
    }

    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const currentPassword = requireString(body, "currentPassword", { maxLength: 128 });
    const newPassword = requireString(body, "newPassword", { minLength: 8, maxLength: 128 });

    await this.authService.changePassword(
      auth.userId,
      auth.sessionId,
      currentPassword,
      newPassword,
    );
    return successResponse(this.codec, {}, 200);
  }
}
