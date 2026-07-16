import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { PreferencesService } from "../../../../domain/preferences/preferencesService.ts";
import {
  type Locale,
  SUPPORTED_LOCALES,
} from "../../../../domain/preferences/preferences.entity.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { asRecord, requireEnum } from "../../../../shared/validation/validator.ts";

/** Auth-scoped preference read access is available before onboarding completes. */
export class GetAuthPreferencesRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/auth/preferences";

  constructor(
    private readonly preferences: PreferencesService,
    private readonly tokenService: TokenService,
    private readonly codec: ProtocolCodec,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await verifyAccessToken(
      this.tokenService,
      extractBearerToken(ctx.request.headers.get("authorization")),
    );
    return successResponse(
      this.codec,
      { preferences: this.preferences.get(auth.userId) },
      200,
    );
  }
}

/** Locale is intentionally the only auth-page writable preference on this route. */
export class UpdateAuthLocaleRoute implements RouteHandler {
  readonly method = "PATCH" as const;
  readonly path = "/api/auth/preferences";

  constructor(
    private readonly preferences: PreferencesService,
    private readonly tokenService: TokenService,
    private readonly codec: ProtocolCodec,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await verifyAccessToken(
      this.tokenService,
      extractBearerToken(ctx.request.headers.get("authorization")),
    );
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const locale = requireEnum(body, "locale", SUPPORTED_LOCALES) as Locale;
    return successResponse(
      this.codec,
      { preferences: this.preferences.update(auth.userId, { locale }) },
      200,
    );
  }
}
