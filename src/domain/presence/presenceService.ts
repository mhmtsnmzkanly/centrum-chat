import type { UserRepository } from "../users/userRepository.port.ts";
import type { UserStatus } from "../users/user.entity.ts";

export interface PresenceTransition {
  readonly userId: string;
  readonly status: UserStatus;
  readonly lastSeenAt: string | null;
}

/**
 * Business consequences of a presence change: what the new status/lastSeenAt should be,
 * and persisting it. Deciding *whether* a given connect/disconnect is actually a
 * transition (i.e. counting concurrent connections for multi-device support) and
 * broadcasting the result are transport-layer concerns (transport/websocket/connection.ts)
 * — this service never touches ConnectionManager or ProtocolCodec.
 */
export class PresenceService {
  constructor(private readonly users: UserRepository) {}

  /** Only a user's *first* concurrent connection is a real transition; pass whether this
   * is the first based on ConnectionManager.isUserOnline() checked before registering. */
  handleConnect(userId: string, isFirstConnection: boolean): PresenceTransition | null {
    if (!isFirstConnection) return null;
    this.users.updateStatus(userId, "online");
    return { userId, status: "online", lastSeenAt: null };
  }

  /** Only a user's *last* concurrent connection closing is a real transition. */
  handleDisconnect(userId: string, isLastConnection: boolean): PresenceTransition | null {
    if (!isLastConnection) return null;
    const lastSeenAt = new Date().toISOString();
    this.users.updateStatus(userId, "offline", lastSeenAt);
    return { userId, status: "offline", lastSeenAt };
  }

  /** Explicit user-driven status change (`presence.update`). */
  updateStatus(userId: string, status: UserStatus): PresenceTransition {
    const lastSeenAt = status === "offline" ? new Date().toISOString() : null;
    this.users.updateStatus(userId, status, lastSeenAt ?? undefined);
    return { userId, status, lastSeenAt };
  }
}
