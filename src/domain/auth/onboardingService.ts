import type { SettingsService } from "../administration/settingsService.ts";
import type { Preferences } from "../preferences/preferences.entity.ts";
import type { PreferencesRepository } from "../preferences/preferencesRepository.port.ts";
import { type Profile, toProfile } from "../users/user.entity.ts";
import type { UserRepository } from "../users/userRepository.port.ts";
import { NotFoundError } from "../../shared/errors/notFoundError.ts";
import type { TransactionManager } from "../../shared/transactions/transactionManager.ts";
import { ValidationError } from "../../shared/errors/validationError.ts";

export type OnboardingStep = "preferences" | "email-verification" | "complete";
export type OnboardingNextAction =
  | "completePreferences"
  | "completeEmailVerification"
  | "resendVerificationEmail"
  | "enterApplication"
  | "logout";

export interface OnboardingPreferencesInput {
  readonly bio: string;
  readonly avatarSeed: string;
  readonly coverIndex: number;
  readonly nameColor: string;
  readonly sound: boolean;
  readonly desktopNotifications: boolean;
  readonly dmPrivacy: Preferences["dmPrivacy"];
  readonly groupPrivacy: Preferences["groupPrivacy"];
  readonly theme: Preferences["theme"];
}

export interface OnboardingStatus {
  readonly authenticated: true;
  readonly onboardingComplete: boolean;
  readonly currentOnboardingStep: OnboardingStep;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly emailVerificationRequired: boolean;
  readonly allowedNextActions: readonly OnboardingNextAction[];
  readonly profile: Profile;
  readonly preferences: Preferences;
}

const NAME_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DM_PRIVACY = new Set(["everyone", "group_members", "no_one"]);
const GROUP_PRIVACY = new Set(["everyone", "dm_contacts", "no_one"]);
const THEMES = new Set(["dark", "light"]);

export class OnboardingService {
  constructor(
    private readonly users: UserRepository,
    private readonly preferences: PreferencesRepository,
    private readonly settings: SettingsService,
    private readonly transactions: TransactionManager,
    private readonly now: () => number = () => Date.now(),
  ) {}

  getStatus(userId: string): OnboardingStatus {
    const user = this.users.findById(userId);
    if (!user) throw new NotFoundError("User not found.", { userId });
    const preferences = this.preferences.getOrCreate(userId);
    const emailVerificationRequired = this.settings.get<boolean>(
      "email_verification_required",
    );
    const preferencesComplete = user.onboardingPreferencesCompletedAt !== null;
    const emailVerified = user.emailVerifiedAt !== null;
    const onboardingComplete = preferencesComplete &&
      (!emailVerificationRequired || emailVerified);
    const currentOnboardingStep: OnboardingStep = !preferencesComplete
      ? "preferences"
      : onboardingComplete
      ? "complete"
      : "email-verification";
    const allowedNextActions: readonly OnboardingNextAction[] =
      currentOnboardingStep === "preferences"
        ? ["completePreferences", "logout"]
        : currentOnboardingStep === "email-verification"
        ? ["completeEmailVerification", "resendVerificationEmail", "logout"]
        : ["enterApplication", "logout"];

    return {
      authenticated: true,
      onboardingComplete,
      currentOnboardingStep,
      email: user.email,
      emailVerified,
      emailVerificationRequired,
      allowedNextActions,
      profile: toProfile(user),
      preferences,
    };
  }

  completePreferences(
    userId: string,
    input: OnboardingPreferencesInput,
  ): OnboardingStatus {
    this.validate(input);
    this.transactions.run(() => {
      if (!this.users.findById(userId)) {
        throw new NotFoundError("User not found.", { userId });
      }
      this.users.update(userId, {
        bio: input.bio,
        avatarSeed: input.avatarSeed,
        coverIndex: input.coverIndex,
        nameColor: input.nameColor,
      });
      this.preferences.update(userId, {
        sound: input.sound,
        desktopNotifications: input.desktopNotifications,
        dmPrivacy: input.dmPrivacy,
        groupPrivacy: input.groupPrivacy,
        theme: input.theme,
      });
      this.users.markOnboardingPreferencesCompleted(
        userId,
        new Date(this.now()).toISOString(),
      );
    });
    return this.getStatus(userId);
  }

  private validate(input: OnboardingPreferencesInput): void {
    if (input.bio.length > 280) {
      throw new ValidationError('"bio" must be at most 280 characters.', { field: "bio" });
    }
    if (input.avatarSeed.length < 1 || input.avatarSeed.length > 100) {
      throw new ValidationError('"avatarSeed" must be between 1 and 100 characters.', {
        field: "avatarSeed",
      });
    }
    if (!Number.isInteger(input.coverIndex) || input.coverIndex < 0) {
      throw new ValidationError('"coverIndex" must be a non-negative integer.', {
        field: "coverIndex",
      });
    }
    if (!NAME_COLOR_PATTERN.test(input.nameColor)) {
      throw new ValidationError('"nameColor" must use the #RRGGBB format.', {
        field: "nameColor",
      });
    }
    if (!DM_PRIVACY.has(input.dmPrivacy)) {
      throw new ValidationError('"dmPrivacy" has an invalid value.', { field: "dmPrivacy" });
    }
    if (!GROUP_PRIVACY.has(input.groupPrivacy)) {
      throw new ValidationError('"groupPrivacy" has an invalid value.', {
        field: "groupPrivacy",
      });
    }
    if (!THEMES.has(input.theme)) {
      throw new ValidationError('"theme" has an invalid value.', { field: "theme" });
    }
  }
}
