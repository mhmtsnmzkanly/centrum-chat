import type { CaptchaContext, CaptchaVerifier, CaptchaVerificationResult } from "../../domain/safety/captchaVerifier.port.ts";

export class DevelopmentCaptchaVerifier implements CaptchaVerifier {
  verify(_token: string | null, _context: CaptchaContext): Promise<CaptchaVerificationResult> {
    return Promise.resolve({ status: "verified" });
  }
}
