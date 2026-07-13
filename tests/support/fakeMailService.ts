import type {
  EmailChangedNoticeInput,
  EmailChangeVerificationMailInput,
  MailService,
  PasswordChangedNoticeInput,
  PasswordResetMailInput,
  VerificationMailInput,
} from "../../src/domain/auth/mailService.port.ts";

export type CapturedMail =
  | { purpose: "verification"; input: VerificationMailInput }
  | { purpose: "password_reset"; input: PasswordResetMailInput }
  | { purpose: "password_changed_notice"; input: PasswordChangedNoticeInput }
  | { purpose: "email_change_verification"; input: EmailChangeVerificationMailInput }
  | { purpose: "email_changed_notice"; input: EmailChangedNoticeInput };

export class FakeMailService implements MailService {
  readonly deliveries: CapturedMail[] = [];

  sendVerificationEmail(input: VerificationMailInput): Promise<void> {
    this.deliveries.push({ purpose: "verification", input });
    return Promise.resolve();
  }

  sendPasswordResetEmail(input: PasswordResetMailInput): Promise<void> {
    this.deliveries.push({ purpose: "password_reset", input });
    return Promise.resolve();
  }

  sendPasswordChangedNotice(input: PasswordChangedNoticeInput): Promise<void> {
    this.deliveries.push({ purpose: "password_changed_notice", input });
    return Promise.resolve();
  }

  sendEmailChangeVerificationEmail(input: EmailChangeVerificationMailInput): Promise<void> {
    this.deliveries.push({ purpose: "email_change_verification", input });
    return Promise.resolve();
  }

  sendEmailChangedNotice(input: EmailChangedNoticeInput): Promise<void> {
    this.deliveries.push({ purpose: "email_changed_notice", input });
    return Promise.resolve();
  }

  latest<TPurpose extends CapturedMail["purpose"]>(
    purpose: TPurpose,
  ): Extract<CapturedMail, { purpose: TPurpose }> | null {
    for (let i = this.deliveries.length - 1; i >= 0; i -= 1) {
      const delivery = this.deliveries[i];
      if (delivery?.purpose === purpose) {
        return delivery as Extract<CapturedMail, { purpose: TPurpose }>;
      }
    }
    return null;
  }
}
