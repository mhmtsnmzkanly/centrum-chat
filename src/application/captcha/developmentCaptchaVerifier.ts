import type { CaptchaContext, CaptchaVerifier } from "../../domain/safety/captchaVerifier.port.ts";

export class DevelopmentCaptchaVerifier implements CaptchaVerifier {
  verify(_token: string | null, _context: CaptchaContext): Promise<boolean> {
    return Promise.resolve(true);
  }
}
