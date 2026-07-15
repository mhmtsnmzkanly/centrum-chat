import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { OnboardingService } from "../../../../domain/auth/onboardingService.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";
import {
  asRecord,
  optionalBoolean,
  optionalInteger,
  requireEnum,
  requireString,
} from "../../../../shared/validation/validator.ts";
import { ValidationError } from "../../../../shared/errors/validationError.ts";
import type {
  DmPrivacy,
  GroupPrivacy,
  Theme,
} from "../../../../domain/preferences/preferences.entity.ts";

const DM_PRIVACY_VALUES: readonly DmPrivacy[] = ["everyone", "group_members", "no_one"];
const GROUP_PRIVACY_VALUES: readonly GroupPrivacy[] = ["everyone", "dm_contacts", "no_one"];
const THEME_VALUES: readonly Theme[] = ["dark", "light"];
const NAME_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export class GetOnboardingStatusRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/auth/onboarding";

  constructor(
    private readonly onboarding: OnboardingService,
    private readonly tokenService: TokenService,
    private readonly codec: ProtocolCodec,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await verifyAccessToken(
      this.tokenService,
      extractBearerToken(ctx.request.headers.get("authorization")),
    );
    return successResponse(this.codec, this.onboarding.getStatus(auth.userId), 200);
  }
}

export class CompleteOnboardingPreferencesRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/auth/onboarding/preferences";

  constructor(
    private readonly onboarding: OnboardingService,
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
        `auth.onboarding.preferences:${auth.userId}`,
        "Too many onboarding updates. Try again later.",
      );
    }

    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const coverIndex = optionalInteger(body, "coverIndex", { min: 0 });
    const sound = optionalBoolean(body, "sound");
    const desktopNotifications = optionalBoolean(body, "desktopNotifications");
    if (coverIndex === undefined) throw requiredField("coverIndex", "an integer");
    if (sound === undefined) throw requiredField("sound", "a boolean");
    if (desktopNotifications === undefined) {
      throw requiredField("desktopNotifications", "a boolean");
    }

    const status = this.onboarding.completePreferences(auth.userId, {
      bio: requireString(body, "bio", { maxLength: 280 }),
      avatarSeed: requireString(body, "avatarSeed", { minLength: 1, maxLength: 100 }),
      coverIndex,
      nameColor: requireString(body, "nameColor", { pattern: NAME_COLOR_PATTERN }),
      sound,
      desktopNotifications,
      dmPrivacy: requireEnum(body, "dmPrivacy", DM_PRIVACY_VALUES),
      groupPrivacy: requireEnum(body, "groupPrivacy", GROUP_PRIVACY_VALUES),
      theme: requireEnum(body, "theme", THEME_VALUES),
    });
    return successResponse(this.codec, status, 200);
  }
}

function requiredField(field: string, type: string): ValidationError {
  return new ValidationError(`"${field}" is required and must be ${type}.`, { field });
}
