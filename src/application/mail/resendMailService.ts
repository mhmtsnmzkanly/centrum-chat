import type {
  EmailChangedNoticeInput,
  EmailChangeVerificationMailInput,
  MailService,
  PasswordChangedNoticeInput,
  PasswordResetMailInput,
  VerificationMailInput,
} from "../../domain/auth/mailService.port.ts";
import {
  renderEmailChangedNotice,
  renderEmailChangeVerificationMail,
  renderPasswordChangedNotice,
  renderPasswordResetMail,
  renderVerificationMail,
} from "./templates/accountSecurityMailTemplates.ts";
import type { RenderedMailTemplate } from "./templates/mailTemplate.types.ts";

export interface ResendMailServiceOptions {
  readonly apiKey: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly fetchImpl?: typeof fetch;
}

export class ResendMailService implements MailService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ResendMailServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  sendVerificationEmail(input: VerificationMailInput): Promise<void> {
    return this.send(input.toEmail, renderVerificationMail(input));
  }

  sendPasswordResetEmail(input: PasswordResetMailInput): Promise<void> {
    return this.send(input.toEmail, renderPasswordResetMail(input));
  }

  sendPasswordChangedNotice(input: PasswordChangedNoticeInput): Promise<void> {
    return this.send(input.toEmail, renderPasswordChangedNotice(input));
  }

  sendEmailChangeVerificationEmail(input: EmailChangeVerificationMailInput): Promise<void> {
    return this.send(input.toEmail, renderEmailChangeVerificationMail(input));
  }

  sendEmailChangedNotice(input: EmailChangedNoticeInput): Promise<void> {
    return this.send(input.toEmail, renderEmailChangedNotice(input));
  }

  private async send(toEmail: string, body: RenderedMailTemplate): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${this.options.fromName} <${this.options.fromAddress}>`,
          to: [toEmail],
          subject: body.subject,
          html: body.html,
          text: body.text,
        }),
      });
    } catch {
      // Fetch/provider errors can contain request metadata. Keep the application log boundary clean.
      throw new Error("Resend mail request failed before receiving a response.");
    }

    if (!response.ok) {
      throw new Error(`Resend mail request failed with status ${response.status}.`);
    }
  }
}
