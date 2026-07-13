import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { RateLimitedError } from "../../../../shared/errors/rateLimitedError.ts";
import {
  asRecord,
  optionalBoolean,
  optionalString,
  requireString,
} from "../../../../shared/validation/validator.ts";
import type { CaptchaVerifier } from "../../../../domain/safety/captchaVerifier.port.ts";
import { CaptchaRequiredError } from "../../../../domain/safety/safetyErrors.ts";
import type { SafetyService } from "../../../../domain/safety/safetyService.ts";

/** docs/04-http-api.md "POST /api/auth/login" — rate-limited by IP (`auth.login`
 * category) since a would-be attacker has no account/userId to key on yet. */
export class LoginRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/login";

  constructor(
    private readonly authService: AuthService,
    private readonly rateLimiter: RateLimiter,
    private readonly codec: ProtocolCodec,
    private readonly captchaVerifier?: CaptchaVerifier,
    private readonly safetyService?: SafetyService,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    if (!this.rateLimiter.check(`auth.login:${ctx.clientIp}`)) {
      throw new RateLimitedError("Too many login attempts. Try again later.");
    }

    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const email = requireString(body, "email");
    const password = requireString(body, "password");
    const rememberMe = optionalBoolean(body, "rememberMe") ?? false;
    const deviceLabel = optionalString(body, "deviceLabel", { maxLength: 100 }) ?? null;
    const captchaToken = optionalString(body, "captchaToken", { maxLength: 4096 }) ?? null;
    if (
      this.captchaVerifier &&
      !await this.captchaVerifier.verify(captchaToken, {
        action: "login",
        clientIp: ctx.clientIp,
      })
    ) {
      this.safetyService?.auditCaptchaFailure("login", ctx.clientIp);
      throw new CaptchaRequiredError("CAPTCHA verification is required.");
    }

    const result = await this.authService.login({ email, password, rememberMe, deviceLabel });
    return successResponse(
      this.codec,
      { user: result.profile, accessToken: result.accessToken, refreshToken: result.refreshToken },
      200,
    );
  }
}
