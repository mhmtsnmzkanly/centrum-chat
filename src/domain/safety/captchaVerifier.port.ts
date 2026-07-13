export interface CaptchaContext {
  readonly action: "register" | "login" | "password_reset";
  readonly clientIp: string;
}

export interface CaptchaVerifier {
  verify(token: string | null, context: CaptchaContext): Promise<boolean>;
}
