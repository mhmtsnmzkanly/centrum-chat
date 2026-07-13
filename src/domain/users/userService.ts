import type { ProfileUpdate, UserRepository } from "./userRepository.port.ts";
import { type Profile, toProfile } from "./user.entity.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";

/** docs/03-websocket-events.md "Module: Profile / Preferences" (profile.get/profile.update). */
export class UserService {
  constructor(private readonly users: UserRepository) {}

  getProfile(userId: string): Profile {
    const user = this.users.findById(userId);
    if (!user) throw new NotFoundError("User not found.", { userId });
    return toProfile(user);
  }

  updateProfile(userId: string, patch: ProfileUpdate): Profile {
    return toProfile(this.users.update(userId, patch));
  }

  /** docs/04-http-api.md "POST /api/media/avatar". Returns the caller's previous
   * `avatarUrl` too, so the route can delete the old file/attachment it pointed at. */
  setAvatarUrl(
    userId: string,
    avatarUrl: string,
  ): { profile: Profile; previousAvatarUrl: string | null } {
    const previous = this.users.findById(userId);
    if (!previous) throw new NotFoundError("User not found.", { userId });
    const updated = this.users.updateAvatarUrl(userId, avatarUrl);
    return { profile: toProfile(updated), previousAvatarUrl: previous.avatarUrl };
  }

  setCoverUrl(
    userId: string,
    coverUrl: string,
  ): { profile: Profile; previousCoverUrl: string | null } {
    const previous = this.users.findById(userId);
    if (!previous) throw new NotFoundError("User not found.", { userId });
    const updated = this.users.updateCoverUrl(userId, coverUrl);
    return { profile: toProfile(updated), previousCoverUrl: previous.coverUrl };
  }
}
