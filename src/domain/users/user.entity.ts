export type UserStatus = "online" | "idle" | "dnd" | "offline";
export type AppRole = "user" | "moderator" | "admin" | "owner";

/** Full internal representation, including the password hash — never returned to a
 * client directly. Client-facing shapes are derived via `toUserSummary`/`toProfile`. */
export interface User {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly emailVerifiedAt: string | null;
  readonly appRole: AppRole;
  readonly mustResetPassword: boolean;
  readonly accountDisabledAt: string | null;
  readonly adminVersion: number;
  readonly passwordHash: string;
  readonly bio: string;
  readonly avatarSeed: string | null;
  readonly avatarUrl: string | null;
  readonly coverIndex: number;
  readonly coverUrl: string | null;
  readonly nameColor: string | null;
  readonly status: UserStatus;
  readonly lastSeenAt: string | null;
  readonly isPremium: boolean;
  readonly messagesSent: number;
  readonly reactionsAdded: number;
  readonly repliesMade: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Wire shape `UserSummary` from docs/03-websocket-events.md. */
export interface UserSummary {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarSeed: string | null;
  readonly avatarUrl: string | null;
  readonly nameColor: string | null;
  readonly status: UserStatus;
}

/** Wire shape `Profile` (`UserSummary & {...}`) from docs/03-websocket-events.md, filled
 * out with `coverIndex`/`coverUrl` since `profile.update` accepts `coverIndex` and the
 * schema already carries both — the doc's terse type alias just didn't spell them out. */
export interface Profile extends UserSummary {
  readonly bio: string;
  readonly joinedDate: string;
  readonly isPremium: boolean;
  readonly messagesSent: number;
  readonly reactionsAdded: number;
  readonly repliesMade: number;
  readonly coverIndex: number;
  readonly coverUrl: string | null;
  readonly isOperator: boolean;
}

export function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarSeed: user.avatarSeed,
    avatarUrl: user.avatarUrl,
    nameColor: user.nameColor,
    status: user.status,
  };
}

export function toProfile(user: User): Profile {
  return {
    ...toUserSummary(user),
    bio: user.bio,
    joinedDate: user.createdAt,
    isPremium: user.isPremium,
    messagesSent: user.messagesSent,
    reactionsAdded: user.reactionsAdded,
    repliesMade: user.repliesMade,
    coverIndex: user.coverIndex,
    coverUrl: user.coverUrl,
    isOperator: user.appRole === "moderator" || user.appRole === "admin" ||
      user.appRole === "owner",
  };
}
