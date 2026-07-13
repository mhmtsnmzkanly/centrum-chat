import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { asRecord, requireString } from "../../../../shared/validation/validator.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";
import { normalizeEmailIdentity } from "../../../../domain/auth/emailAddress.ts";
import { optionalString } from "../../../../shared/validation/validator.ts";
import type { CaptchaVerifier } from "../../../../domain/safety/captchaVerifier.port.ts";
import type { SafetyService } from "../../../../domain/safety/safetyService.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENERIC_MESSAGE =
  "If an account exists for that email, a password reset message has been sent.";

export class PasswordResetRequestRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/password-reset/request";

  constructor(
    private readonly authService: AuthService,
    private readonly codec: ProtocolCodec,
    private readonly ipRateLimiter?: RateLimiter,
    private readonly emailRateLimiter?: RateLimiter,
    private readonly captchaVerifier?: CaptchaVerifier,
    private readonly safetyService?: SafetyService,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const email = normalizeEmailIdentity(
      requireString(body, "email", { pattern: EMAIL_PATTERN, maxLength: 254 }),
    );
    const captchaToken = optionalString(body, "captchaToken", { maxLength: 4096 }) ?? null;
    if (this.ipRateLimiter) {
      requireHttpRateLimit(
        this.ipRateLimiter,
        `auth.password-reset.request:ip:${ctx.clientIp}`,
        "Too many password reset attempts. Try again later.",
      );
    }
    if (this.emailRateLimiter) {
      requireHttpRateLimit(
        this.emailRateLimiter,
        `auth.password-reset.request:email:${email}`,
        "Too many password reset attempts. Try again later.",
      );
    }
    if (
      this.captchaVerifier &&
      !await this.captchaVerifier.verify(captchaToken, {
        action: "password_reset",
        clientIp: ctx.clientIp,
      })
    ) {
      this.safetyService?.auditCaptchaFailure("password_reset", ctx.clientIp);
      return successResponse(this.codec, { message: GENERIC_MESSAGE }, 200);
    }
    await this.authService.requestPasswordReset(email);
    return successResponse(this.codec, { message: GENERIC_MESSAGE }, 200);
  }
}
