import type { CaptchaContext, CaptchaVerifier } from "../../domain/safety/captchaVerifier.port.ts";

export interface TurnstileCaptchaVerifierOptions {
  readonly secretKey: string;
  readonly expectedHostname: string;
  readonly fetchImpl?: typeof fetch;
}

interface TurnstileResponse {
  readonly success?: boolean;
  readonly hostname?: string;
  readonly action?: string;
}

export class TurnstileCaptchaVerifier implements CaptchaVerifier {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TurnstileCaptchaVerifierOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async verify(token: string | null, context: CaptchaContext): Promise<boolean> {
    if (!token) return false;
    const body = new URLSearchParams({
      secret: this.options.secretKey,
      response: token,
      remoteip: context.clientIp,
    });
    try {
      const response = await this.fetchImpl(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        { method: "POST", body },
      );
      if (!response.ok) return false;
      const result = await response.json() as TurnstileResponse;
      return result.success === true &&
        result.hostname === this.options.expectedHostname &&
        result.action === context.action;
    } catch {
      return false;
    }
  }
}
