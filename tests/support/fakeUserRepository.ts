import type {
  NewUser,
  ProfileUpdate,
  UserRepository,
} from "../../src/domain/users/userRepository.port.ts";
import type { User, UserStatus } from "../../src/domain/users/user.entity.ts";

function makeUser(overrides: NewUser & { id: string }): User {
  const now = new Date().toISOString();
  return {
    id: overrides.id,
    username: overrides.username,
    displayName: overrides.displayName,
    email: overrides.email,
    emailVerifiedAt: null,
    appRole: "user",
    mustResetPassword: false,
    accountDisabledAt: null,
    adminVersion: 1,
    passwordHash: overrides.passwordHash,
    bio: "",
    avatarSeed: null,
    avatarUrl: null,
    coverIndex: 0,
    coverUrl: null,
    nameColor: null,
    status: "offline",
    lastSeenAt: null,
    isPremium: false,
    messagesSent: 0,
    reactionsAdded: 0,
    repliesMade: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** In-memory fake UserRepository — unit tests exercise domain services against fake
 * repos (docs/05-folder-structure.md tests/unit convention), not real SQLite. */
export class FakeUserRepository implements UserRepository {
  private readonly usersById = new Map<string, User>();

  create(user: NewUser): User {
    const created = makeUser(user);
    this.usersById.set(created.id, created);
    return created;
  }

  findById(id: string): User | null {
    return this.usersById.get(id) ?? null;
  }

  findByEmail(email: string): User | null {
    return [...this.usersById.values()].find((u) => u.email === email) ?? null;
  }

  findByUsername(username: string): User | null {
    return [...this.usersById.values()].find((u) => u.username === username) ?? null;
  }

  update(id: string, patch: ProfileUpdate): User {
    const existing = this.usersById.get(id);
    if (!existing) throw new Error("Failed to read back updated user.");
    const updated: User = {
      ...existing,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
      ...(patch.avatarSeed !== undefined ? { avatarSeed: patch.avatarSeed } : {}),
      ...(patch.nameColor !== undefined ? { nameColor: patch.nameColor } : {}),
      ...(patch.coverIndex !== undefined ? { coverIndex: patch.coverIndex } : {}),
      ...(patch.isPremium !== undefined ? { isPremium: patch.isPremium } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.usersById.set(id, updated);
    return updated;
  }

  updateStatus(id: string, status: UserStatus, lastSeenAt?: string): void {
    const existing = this.usersById.get(id);
    if (!existing) return;
    this.usersById.set(id, {
      ...existing,
      status,
      lastSeenAt: lastSeenAt ?? existing.lastSeenAt,
      updatedAt: new Date().toISOString(),
    });
  }

  updateAvatarUrl(id: string, avatarUrl: string): User {
    const existing = this.usersById.get(id);
    if (!existing) throw new Error("Failed to read back updated user.");
    const updated: User = { ...existing, avatarUrl, updatedAt: new Date().toISOString() };
    this.usersById.set(id, updated);
    return updated;
  }

  updateCoverUrl(id: string, coverUrl: string): User {
    const existing = this.usersById.get(id);
    if (!existing) throw new Error("Failed to read back updated user.");
    const updated: User = { ...existing, coverUrl, updatedAt: new Date().toISOString() };
    this.usersById.set(id, updated);
    return updated;
  }

  clearForcedPasswordReset(id: string): void {
    const existing = this.usersById.get(id);
    if (!existing) return;
    this.usersById.set(id, {
      ...existing,
      mustResetPassword: false,
      adminVersion: existing.adminVersion + 1,
    });
  }

  updatePasswordHash(id: string, passwordHash: string): User {
    const existing = this.usersById.get(id);
    if (!existing) throw new Error("Failed to read back updated user.");
    const updated: User = { ...existing, passwordHash, updatedAt: new Date().toISOString() };
    this.usersById.set(id, updated);
    return updated;
  }

  updatePasswordHashIfCurrent(
    id: string,
    currentPasswordHash: string,
    newPasswordHash: string,
  ): User | null {
    const existing = this.usersById.get(id);
    if (!existing || existing.passwordHash !== currentPasswordHash) return null;
    const updated: User = {
      ...existing,
      passwordHash: newPasswordHash,
      updatedAt: new Date().toISOString(),
    };
    this.usersById.set(id, updated);
    return updated;
  }

  markEmailVerified(id: string, verifiedAt: string): User {
    const existing = this.usersById.get(id);
    if (!existing) throw new Error("Failed to read back updated user.");
    const updated: User = {
      ...existing,
      emailVerifiedAt: verifiedAt,
      updatedAt: new Date().toISOString(),
    };
    this.usersById.set(id, updated);
    return updated;
  }

  updateEmail(id: string, email: string, verifiedAt: string): User {
    const existing = this.usersById.get(id);
    if (!existing) throw new Error("Failed to read back updated user.");
    const updated: User = {
      ...existing,
      email,
      emailVerifiedAt: verifiedAt,
      updatedAt: new Date().toISOString(),
    };
    this.usersById.set(id, updated);
    return updated;
  }

  search(query: string, limit: number): User[] {
    const lowerQuery = query.toLowerCase();
    return [...this.usersById.values()]
      .filter((u) =>
        u.username.toLowerCase().includes(lowerQuery) ||
        u.displayName.toLowerCase().includes(lowerQuery)
      )
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, limit);
  }
}
