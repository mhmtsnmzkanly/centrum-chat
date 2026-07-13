import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";

export class PasswordResetCompleteRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/password-reset/complete";

  constructor(
    private readonly authService: AuthService,
    private readonly codec: ProtocolCodec,
    private readonly rateLimiter?: RateLimiter,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    if (this.rateLimiter) {
      requireHttpRateLimit(
        this.rateLimiter,
        `auth.password-reset.complete:${ctx.clientIp}`,
        "Too many password reset attempts. Try again later.",
      );
    }
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const token = requireString(body, "token");
    const newPassword = requireString(body, "newPassword", { minLength: 8, maxLength: 128 });
    await this.authService.completePasswordReset(token, newPassword);
    return successResponse(this.codec, {}, 200);
  }
}
