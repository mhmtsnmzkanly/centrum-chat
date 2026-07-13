import { base64UrlDecode, base64UrlEncode, toHex } from "../../shared/crypto/encoding.ts";

export interface AccessTokenPayload {
  readonly sub: string;
  readonly sid: string;
  readonly username: string;
  readonly iat: number;
  readonly exp: number;
}

export interface TokenServiceOptions {
  readonly secret: string;
  readonly accessTokenTtlSeconds: number;
}

/**
 * Hand-rolled HS256 JWT sign/verify over Web Crypto's HMAC, plus opaque refresh-token
 * generation/hashing. No external JWT library is pulled in for one algorithm.
 *
 * JWT's own wire format is JSON per RFC 7519 — a fixed property of the token spec,
 * unrelated to CentrumChat's client-facing ProtocolCodec (JsonCodec/EnfCodec) boundary.
 * JSON.stringify/parse here is exempt from that rule the same way structured log lines
 * are (see shared/logging/logger.ts): swapping the client wire protocol never touches
 * this file, and this file never touches a client-facing envelope.
 */
export class TokenService {
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(private readonly options: TokenServiceOptions) {
    this.keyPromise = crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(options.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }

  async signAccessToken(
    userId: string,
    username: string,
    sessionId: string = crypto.randomUUID(),
  ): Promise<string> {
    const key = await this.keyPromise;
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "HS256", typ: "JWT" };
    const payload: AccessTokenPayload = {
      sub: userId,
      sid: sessionId,
      username,
      iat: now,
      exp: now + this.options.accessTokenTtlSeconds,
    };

    const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
    const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signingInput),
    );
    return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  }

  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await this.keyPromise;
    let signatureValid: boolean;
    try {
      signatureValid = await crypto.subtle.verify(
        "HMAC",
        key,
        base64UrlDecode(encodedSignature) as BufferSource,
        new TextEncoder().encode(signingInput),
      );
    } catch {
      return null;
    }
    if (!signatureValid) return null;

    let payload: AccessTokenPayload;
    try {
      payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload)));
    } catch {
      return null;
    }
    if (typeof payload.exp !== "number" || typeof payload.sub !== "string") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  }

  /** Opaque 256-bit refresh token — random, not a JWT, per docs/04-http-api.md. */
  generateOpaqueToken(): string {
    return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  }

  generateRefreshToken(): string {
    return this.generateOpaqueToken();
  }

  /** Refresh tokens are already high-entropy random values, so a fast one-way SHA-256
   * digest (not PBKDF2) is sufficient to keep a leaked DB row from being directly
   * usable — unlike passwords, there's no dictionary attack surface to slow down. */
  async hashRefreshToken(token: string): Promise<string> {
    return await this.hashOpaqueToken(token);
  }

  async hashOpaqueToken(token: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return toHex(digest);
  }
}
