import type { UserRepository } from "../users/userRepository.port.ts";
import type { SettingsService } from "../administration/settingsService.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";
import { EmailVerificationRequiredError } from "./emailVerificationRequiredError.ts";

export class AccountPolicy {
  constructor(
    private readonly users: UserRepository,
    private readonly settings?: SettingsService,
  ) {}

  requireVerifiedEmail(userId: string): void {
    if (this.settings && !this.settings.get<boolean>("email_verification_required")) return;
    const user = this.users.findById(userId);
    if (!user) throw new NotFoundError("User not found.", { userId });
    if (!user.emailVerifiedAt) {
      throw new EmailVerificationRequiredError(
        "Email verification is required before using this feature.",
      );
    }
  }
}
