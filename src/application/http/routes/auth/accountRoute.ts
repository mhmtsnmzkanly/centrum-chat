import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { AuthService } from "../../../../domain/auth/authService.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";

export class AccountRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/auth/account";

  constructor(
    private readonly authService: AuthService,
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
      this.authService.getAccountSecurityStatus(auth.userId),
      200,
    );
  }
}
