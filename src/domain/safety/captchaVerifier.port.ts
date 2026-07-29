export interface CaptchaContext {
  readonly action: "register" | "login" | "password-reset-request";
  readonly clientIp: string;
}

/** Provider-neutral result: no provider response or token is allowed past this port. */
export type CaptchaVerificationResult =
  | { readonly status: "verified" }
  | { readonly status: "invalid"; readonly reason: "missing" | "rejected" | "expired" | "action-mismatch" | "hostname-mismatch" | "malformed-response" }
  | { readonly status: "unavailable" };

export interface CaptchaVerifier {
  verify(token: string | null, context: CaptchaContext): Promise<CaptchaVerificationResult>;
}
