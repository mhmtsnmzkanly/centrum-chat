import type { PasswordHasher } from "./passwordHasher.port.ts";
import { fromHex, toHex } from "../../shared/crypto/encoding.ts";

const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_LENGTH_BITS = 256;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return toHex(bits);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** PBKDF2-HMAC-SHA256 via Web Crypto — native to Deno, no external hashing dependency.
 * Encoded as `pbkdf2$<iterations>$<saltHex>$<hashHex>` so the iteration count can be
 * raised later without invalidating hashes already stored for existing users. */
export class WebCryptoPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const derived = await derive(password, salt, ITERATIONS);
    return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${derived}`;
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const parts = hash.split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const [, iterationsPart, saltHex, expected] = parts as [string, string, string, string];
    const iterations = Number.parseInt(iterationsPart, 10);
    if (Number.isNaN(iterations)) return false;
    const actual = await derive(password, fromHex(saltHex), iterations);
    return timingSafeEqual(actual, expected);
  }
}
