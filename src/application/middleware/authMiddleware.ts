import type { TokenService } from "../../domain/auth/tokenService.ts";
import { UnauthorizedError } from "../../shared/errors/unauthorizedError.ts";

export interface AuthenticatedAccessContext {
  readonly userId: string;
  readonly username: string;
  readonly sessionId: string;
}

/** Extracts the token from a `Authorization: Bearer <token>` header, or null if absent
 * or malformed. */
export function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/.exec(header);
  return match?.[1] ?? null;
}

/** Verifies an access token and returns the authenticated userId, or throws
 * UnauthorizedError. Shared by HTTP routes (Authorization header) and the WS upgrade
 * handshake (`?token=` query param) — the one place both transports resolve "who is
 * this request from". */
export async function verifyAccessToken(
  tokenService: TokenService,
  token: string | null,
): Promise<AuthenticatedAccessContext> {
  if (!token) {
    throw new UnauthorizedError("Missing access token.");
  }
  const payload = await tokenService.verifyAccessToken(token);
  if (!payload || typeof payload.username !== "string" || typeof payload.sid !== "string") {
    throw new UnauthorizedError("Invalid or expired access token.");
  }
  return { userId: payload.sub, username: payload.username, sessionId: payload.sid };
}
