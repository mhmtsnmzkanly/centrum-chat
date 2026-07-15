import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { OnboardingService } from "../../src/domain/auth/onboardingService.ts";
import { AccountPolicy } from "../../src/domain/auth/accountPolicy.ts";
import { OnboardingRequiredError } from "../../src/domain/auth/onboardingRequiredError.ts";
import { EmailVerificationRequiredError } from "../../src/domain/auth/emailVerificationRequiredError.ts";
import type { SettingsService } from "../../src/domain/administration/settingsService.ts";
import { FakeUserRepository } from "../support/fakeUserRepository.ts";
import { FakePreferencesRepository } from "../support/fakePreferencesRepository.ts";
import { FakeTransactionManager } from "../support/fakeTransactionManager.ts";

const INPUT = {
  bio: "Hello",
  avatarSeed: "sunrise",
  coverIndex: 2,
  nameColor: "#12ABef",
  sound: false,
  desktopNotifications: true,
  dmPrivacy: "group_members" as const,
  groupPrivacy: "dm_contacts" as const,
  theme: "light" as const,
};

function settings(required: boolean): SettingsService {
  return {
    get<T>(key: string): T {
      if (key !== "email_verification_required") throw new Error(`unexpected setting ${key}`);
      return required as T;
    },
  } as SettingsService;
}

function createHarness(verificationRequired: boolean) {
  const users = new FakeUserRepository();
  const preferences = new FakePreferencesRepository();
  const transactions = new FakeTransactionManager();
  const user = users.create({
    id: "user-1",
    username: "alice",
    displayName: "Alice",
    email: "alice@example.com",
    passwordHash: "hash",
  });
  const service = new OnboardingService(
    users,
    preferences,
    settings(verificationRequired),
    transactions,
    () => Date.parse("2026-07-15T10:00:00.000Z"),
  );
  return { users, transactions, user, service };
}

Deno.test("OnboardingService completes preferences atomically and is idempotent when verification is disabled", () => {
  const { users, transactions, service } = createHarness(false);
  assertEquals(service.getStatus("user-1").currentOnboardingStep, "preferences");

  const completed = service.completePreferences("user-1", INPUT);
  assertEquals(completed.onboardingComplete, true);
  assertEquals(completed.currentOnboardingStep, "complete");
  assertEquals(completed.allowedNextActions, ["enterApplication", "logout"]);
  assertEquals(completed.profile.bio, "Hello");
  assertEquals(completed.preferences.theme, "light");
  assertEquals(transactions.calls, ["run"]);

  const firstCompletedAt = users.findById("user-1")?.onboardingPreferencesCompletedAt;
  const repeated = service.completePreferences("user-1", { ...INPUT, bio: "Updated" });
  assertEquals(repeated.onboardingComplete, true);
  assertEquals(repeated.profile.bio, "Updated");
  assertEquals(users.findById("user-1")?.onboardingPreferencesCompletedAt, firstCompletedAt);
});

Deno.test("OnboardingService requires email verification only after preferences when policy is enabled", () => {
  const { users, service } = createHarness(true);
  const pending = service.completePreferences("user-1", INPUT);
  assertEquals(pending.onboardingComplete, false);
  assertEquals(pending.currentOnboardingStep, "email-verification");
  assertEquals(pending.emailVerified, false);
  assertEquals(pending.allowedNextActions, [
    "completeEmailVerification",
    "resendVerificationEmail",
    "logout",
  ]);

  users.markEmailVerified("user-1", "2026-07-15T10:05:00.000Z");
  const completed = service.getStatus("user-1");
  assertEquals(completed.onboardingComplete, true);
  assertEquals(completed.currentOnboardingStep, "complete");
});

Deno.test("AccountPolicy blocks incomplete application access and preserves verification branching", () => {
  const { users } = createHarness(true);
  const policy = new AccountPolicy(users, settings(true));
  assertThrows(() => policy.requireOnboardingComplete("user-1"), OnboardingRequiredError);

  users.markOnboardingPreferencesCompleted("user-1", "2026-07-15T10:00:00.000Z");
  assertThrows(
    () => policy.requireOnboardingComplete("user-1"),
    EmailVerificationRequiredError,
  );

  users.markEmailVerified("user-1", "2026-07-15T10:05:00.000Z");
  policy.requireOnboardingComplete("user-1");
});
