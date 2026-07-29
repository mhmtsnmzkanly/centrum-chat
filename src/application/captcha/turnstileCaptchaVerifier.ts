import type {
  CaptchaContext,
  CaptchaVerificationResult,
  CaptchaVerifier,
} from "../../domain/safety/captchaVerifier.port.ts";
import { generateId } from "../../shared/id.ts";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2_048;

export interface TurnstileCaptchaVerifierOptions {
  readonly secretKey: string;
  readonly expectedHostnames: readonly string[];
  readonly timeoutMs: number;
  readonly fetchImpl?: typeof fetch;
}

interface TurnstileResponse {
  readonly success?: unknown;
  readonly hostname?: unknown;
  readonly action?: unknown;
  readonly "error-codes"?: unknown;
}

function invalidReason(response: TurnstileResponse): CaptchaVerificationResult {
  const errors = Array.isArray(response["error-codes"])
    ? response["error-codes"].filter((value): value is string => typeof value === "string")
    : [];
  if (errors.includes("timeout-or-duplicate")) return { status: "invalid", reason: "expired" };
  return { status: "invalid", reason: "rejected" };
}

/** Cloudflare-specific transport adapter. It deliberately exposes no provider details to callers. */
export class TurnstileCaptchaVerifier implements CaptchaVerifier {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TurnstileCaptchaVerifierOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async verify(token: string | null, context: CaptchaContext): Promise<CaptchaVerificationResult> {
    const normalizedToken = token?.trim();
    if (!normalizedToken) return { status: "invalid", reason: "missing" };
    if (normalizedToken.length > MAX_TOKEN_LENGTH) return { status: "invalid", reason: "rejected" };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const body = new URLSearchParams({
        secret: this.options.secretKey,
        response: normalizedToken,
        remoteip: context.clientIp,
        idempotency_key: generateId(),
      });
      const response = await this.fetchImpl(SITEVERIFY_URL, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      if (!response.ok) return { status: "unavailable" };

      let result: TurnstileResponse;
      try {
        result = await response.json() as TurnstileResponse;
      } catch {
        return { status: "invalid", reason: "malformed-response" };
      }
      if (!result || typeof result !== "object" || typeof result.success !== "boolean") {
        return { status: "invalid", reason: "malformed-response" };
      }
      if (result.success !== true) return invalidReason(result);
      if (typeof result.action !== "string" || result.action !== context.action) {
        return { status: "invalid", reason: "action-mismatch" };
      }
      if (
        typeof result.hostname !== "string" ||
        !this.options.expectedHostnames.includes(result.hostname)
      ) {
        return { status: "invalid", reason: "hostname-mismatch" };
      }
      return { status: "verified" };
    } catch {
      return { status: "unavailable" };
    } finally {
      clearTimeout(timeout);
    }
  }
}
