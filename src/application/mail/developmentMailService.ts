import type {
  EmailChangedNoticeInput,
  EmailChangeVerificationMailInput,
  MailService,
  PasswordChangedNoticeInput,
  PasswordResetMailInput,
  VerificationMailInput,
} from "../../domain/auth/mailService.port.ts";
import type { Logger } from "../../shared/logging/logger.ts";

export class DevelopmentMailService implements MailService {
  constructor(private readonly logger: Logger) {}

  sendVerificationEmail(input: VerificationMailInput): Promise<void> {
    this.logger.info("development mail event generated", {
      purpose: "email_verification",
      toEmail: input.toEmail,
    });
    return Promise.resolve();
  }

  sendPasswordResetEmail(input: PasswordResetMailInput): Promise<void> {
    this.logger.info("development mail event generated", {
      purpose: "password_reset",
      toEmail: input.toEmail,
    });
    return Promise.resolve();
  }

  sendPasswordChangedNotice(input: PasswordChangedNoticeInput): Promise<void> {
    this.logger.info("development mail event generated", {
      purpose: "password_changed_notice",
      toEmail: input.toEmail,
    });
    return Promise.resolve();
  }

  sendEmailChangeVerificationEmail(input: EmailChangeVerificationMailInput): Promise<void> {
    this.logger.info("development mail event generated", {
      purpose: "email_change_verification",
      toEmail: input.toEmail,
    });
    return Promise.resolve();
  }

  sendEmailChangedNotice(input: EmailChangedNoticeInput): Promise<void> {
    this.logger.info("development mail event generated", {
      purpose: "email_changed_notice",
      toEmail: input.toEmail,
      newEmail: input.newEmail,
    });
    return Promise.resolve();
  }
}
