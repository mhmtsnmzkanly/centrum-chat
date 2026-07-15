import type { AdministrationRepository } from "./administrationRepository.port.ts";
import type { SettingsService } from "./settingsService.ts";
import {
  AccountDisabledError,
  ForcePasswordResetRequiredError,
  MaintenanceModeError,
  RegistrationDisabledError,
} from "./administrationErrors.ts";
import type { AccountPolicy } from "../auth/accountPolicy.ts";

export class RuntimePolicy {
  constructor(
    private readonly repository: AdministrationRepository,
    private readonly settings: SettingsService,
    private readonly accountPolicy?: AccountPolicy,
  ) {}

  requireRegistration(): void {
    if (!this.settings.get<boolean>("registration_enabled")) {
      throw new RegistrationDisabledError("Registration is currently disabled.");
    }
  }

  requireAccountAccess(userId: string): void {
    const user = this.repository.findAdminUser(userId, new Date().toISOString());
    if (!user || user.accountDisabledAt) {
      throw new AccountDisabledError("This account is disabled.");
    }
    if (user.mustResetPassword) {
      throw new ForcePasswordResetRequiredError("A password reset is required.");
    }
    this.accountPolicy?.requireOnboardingComplete(userId);
  }

  requireMutation(userId: string): void {
    this.requireAccountAccess(userId);
    if (this.settings.get<boolean>("maintenance_mode")) {
      throw new MaintenanceModeError("The service is in maintenance mode.");
    }
  }

  requireChannelMutation(channelId: string): void {
    const channel = this.repository.findAdminChannel(channelId);
    if (channel?.state === "archived") {
      throw new MaintenanceModeError("This channel is archived.");
    }
  }
}
