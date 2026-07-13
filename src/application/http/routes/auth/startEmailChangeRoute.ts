import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class StartEmailChangeRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/email-change/start";

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
        `auth.email-change.start:${auth.userId}`,
        "Too many email change attempts. Try again later.",
      );
    }
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const currentPassword = requireString(body, "currentPassword");
    const newEmail = requireString(body, "newEmail", { pattern: EMAIL_PATTERN, maxLength: 254 });
    await this.authService.startEmailChange(auth.userId, currentPassword, newEmail);
    return successResponse(this.codec, {}, 200);
  }
}
