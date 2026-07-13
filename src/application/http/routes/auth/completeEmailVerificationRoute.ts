import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";

export class CompleteEmailVerificationRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/verify-email/complete";

  constructor(
    private readonly authService: AuthService,
    private readonly codec: ProtocolCodec,
    private readonly rateLimiter?: RateLimiter,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    if (this.rateLimiter) {
      requireHttpRateLimit(
        this.rateLimiter,
        `auth.verify-email.complete:${ctx.clientIp}`,
        "Too many verification attempts. Try again later.",
      );
    }
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const token = requireString(body, "token");
    await this.authService.verifyEmail(token);
    return successResponse(this.codec, { verified: true }, 200);
  }
}
