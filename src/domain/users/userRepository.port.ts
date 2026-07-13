import type { User, UserStatus } from "./user.entity.ts";

export interface NewUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly passwordHash: string;
}

/** Fields `profile.update` may change (docs/03-websocket-events.md "Module: Profile / Preferences"). */
export interface ProfileUpdate {
  readonly displayName?: string;
  readonly bio?: string;
  readonly avatarSeed?: string;
  readonly nameColor?: string;
  readonly coverIndex?: number;
  readonly isPremium?: boolean;
}

/** Port implemented by `storage/repositories/sqliteUserRepository.ts`. The domain layer
 * only ever depends on this interface, never on SQLite directly. */
export interface UserRepository {
  create(user: NewUser): User;
  findById(id: string): User | null;
  findByEmail(email: string): User | null;
  findByUsername(username: string): User | null;
  update(id: string, patch: ProfileUpdate): User;
  /** `lastSeenAt` is left unchanged when omitted (only meaningful on the online->offline
   * transition). */
  updateStatus(id: string, status: UserStatus, lastSeenAt?: string): void;
  /** Set by `POST /api/media/avatar` (docs/04-http-api.md), distinct from `update`'s
   * `avatarSeed` (the generated placeholder avatar) since an uploaded avatar overrides it. */
  updateAvatarUrl(id: string, avatarUrl: string): User;
  updateCoverUrl(id: string, coverUrl: string): User;
  clearForcedPasswordReset(id: string): void;
  updatePasswordHash(id: string, passwordHash: string): User;
  /** Compare-and-swap password update used after asynchronous password verification/hashing. */
  updatePasswordHashIfCurrent(
    id: string,
    currentPasswordHash: string,
    newPasswordHash: string,
  ): User | null;
  markEmailVerified(id: string, verifiedAt: string): User;
  updateEmail(id: string, email: string, verifiedAt: string): User;
  /** docs/03-websocket-events.md `search.users` — substring match on username or
   * display name. */
  search(query: string, limit: number): User[];
}
