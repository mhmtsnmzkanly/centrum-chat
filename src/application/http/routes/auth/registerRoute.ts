import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import {
  asRecord,
  optionalBoolean,
  optionalString,
  requireString,
} from "../../../../shared/validation/validator.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";
import type { CaptchaVerifier } from "../../../../domain/safety/captchaVerifier.port.ts";
import { CaptchaRequiredError } from "../../../../domain/safety/safetyErrors.ts";
import type { SafetyService } from "../../../../domain/safety/safetyService.ts";
import type { RuntimePolicy } from "../../../../domain/administration/runtimePolicy.ts";

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** docs/04-http-api.md "POST /api/auth/register". */
export class RegisterRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/register";

  constructor(
    private readonly authService: AuthService,
    private readonly codec: ProtocolCodec,
    private readonly rateLimiter?: RateLimiter,
    private readonly captchaVerifier?: CaptchaVerifier,
    private readonly safetyService?: SafetyService,
    private readonly runtimePolicy?: RuntimePolicy,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    this.runtimePolicy?.requireRegistration();
    if (this.rateLimiter) {
      requireHttpRateLimit(
        this.rateLimiter,
        `auth.register:${ctx.clientIp}`,
        "Too many registration attempts. Try again later.",
      );
    }
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const username = requireString(body, "username", { pattern: USERNAME_PATTERN });
    const email = requireString(body, "email", { pattern: EMAIL_PATTERN, maxLength: 254 });
    const password = requireString(body, "password", { minLength: 8, maxLength: 128 });
    const displayName = requireString(body, "displayName", { minLength: 1, maxLength: 50 });
    const rememberMe = optionalBoolean(body, "rememberMe") ?? false;
    const deviceLabel = optionalString(body, "deviceLabel", { maxLength: 100 }) ?? null;
    const captchaToken = optionalString(body, "captchaToken", { maxLength: 4096 }) ?? null;
    if (
      this.captchaVerifier &&
      !await this.captchaVerifier.verify(captchaToken, {
        action: "register",
        clientIp: ctx.clientIp,
      })
    ) {
      this.safetyService?.auditCaptchaFailure("register", ctx.clientIp);
      throw new CaptchaRequiredError("CAPTCHA verification is required.");
    }

    const result = await this.authService.register({
      username,
      email,
      password,
      displayName,
      rememberMe,
      deviceLabel,
      clientIp: ctx.clientIp,
      userAgent: ctx.request.headers.get("user-agent"),
    });
    return successResponse(
      this.codec,
      { user: result.profile, accessToken: result.accessToken, refreshToken: result.refreshToken },
      201,
    );
  }
}
