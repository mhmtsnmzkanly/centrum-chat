/** Port for password hashing/verification, implemented by `webCryptoPasswordHasher.ts`.
 * Kept swappable in case the hashing scheme changes later without touching AuthService. */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, hash: string): Promise<boolean>;
}
