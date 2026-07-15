import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";

export class PublicConfigRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/config/public";
  constructor(
    private readonly codec: ProtocolCodec,
    private readonly captchaProvider: "development" | "turnstile" | "none",
    private readonly captchaSiteKey: string,
    private readonly emailVerificationRequired: () => boolean = () => false,
  ) {}
  handle(_ctx: HttpRequestContext): Response {
    return successResponse(this.codec, {
      captcha: {
        provider: this.captchaProvider,
        siteKey: this.captchaSiteKey || null,
      },
      emailVerificationRequired: this.emailVerificationRequired(),
    }, 200);
  }
}
