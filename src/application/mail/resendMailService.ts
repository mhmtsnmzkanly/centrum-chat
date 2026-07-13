import type {
  EmailChangedNoticeInput,
  EmailChangeVerificationMailInput,
  MailService,
  PasswordChangedNoticeInput,
  PasswordResetMailInput,
  VerificationMailInput,
} from "../../domain/auth/mailService.port.ts";

export interface ResendMailServiceOptions {
  readonly apiKey: string;
  readonly fromAddress: string;
  readonly fromName: string;
  readonly fetchImpl?: typeof fetch;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

interface MailBody {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

function verificationBody(input: VerificationMailInput): MailBody {
  const name = escapeHtml(input.displayName);
  const url = escapeHtml(input.verificationUrl);
  return {
    subject: "Verify your CentrumChat email",
    html:
      `<p>Hello ${name},</p><p>Verify your email address to unlock messaging, uploads, reactions, and group creation.</p><p><a href="${url}">Verify email</a></p>`,
    text:
      `Hello ${input.displayName},\n\nVerify your email address to unlock messaging, uploads, reactions, and group creation.\n\n${input.verificationUrl}\n`,
  };
}

function passwordResetBody(input: PasswordResetMailInput): MailBody {
  const name = escapeHtml(input.displayName);
  const url = escapeHtml(input.resetUrl);
  return {
    subject: "Reset your CentrumChat password",
    html:
      `<p>Hello ${name},</p><p>A password reset was requested for your CentrumChat account.</p><p><a href="${url}">Reset password</a></p>`,
    text:
      `Hello ${input.displayName},\n\nA password reset was requested for your CentrumChat account.\n\n${input.resetUrl}\n`,
  };
}

function passwordChangedBody(input: PasswordChangedNoticeInput): MailBody {
  const name = escapeHtml(input.displayName);
  return {
    subject: "Your CentrumChat password was changed",
    html:
      `<p>Hello ${name},</p><p>Your CentrumChat password was changed. If this was not you, reset your password immediately.</p>`,
    text:
      `Hello ${input.displayName},\n\nYour CentrumChat password was changed. If this was not you, reset your password immediately.\n`,
  };
}

function emailChangeVerificationBody(input: EmailChangeVerificationMailInput): MailBody {
  const name = escapeHtml(input.displayName);
  const url = escapeHtml(input.verificationUrl);
  return {
    subject: "Confirm your new CentrumChat email address",
    html:
      `<p>Hello ${name},</p><p>Confirm this email address to complete your CentrumChat email change.</p><p><a href="${url}">Confirm new email</a></p>`,
    text:
      `Hello ${input.displayName},\n\nConfirm this email address to complete your CentrumChat email change.\n\n${input.verificationUrl}\n`,
  };
}

function emailChangedNoticeBody(input: EmailChangedNoticeInput): MailBody {
  const name = escapeHtml(input.displayName);
  const newEmail = escapeHtml(input.newEmail);
  return {
    subject: "Your CentrumChat email was changed",
    html:
      `<p>Hello ${name},</p><p>Your CentrumChat login email has been changed to <strong>${newEmail}</strong>.</p>`,
    text:
      `Hello ${input.displayName},\n\nYour CentrumChat login email has been changed to ${input.newEmail}.\n`,
  };
}

export class ResendMailService implements MailService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ResendMailServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  sendVerificationEmail(input: VerificationMailInput): Promise<void> {
    return this.send(input.toEmail, verificationBody(input));
  }

  sendPasswordResetEmail(input: PasswordResetMailInput): Promise<void> {
    return this.send(input.toEmail, passwordResetBody(input));
  }

  sendPasswordChangedNotice(input: PasswordChangedNoticeInput): Promise<void> {
    return this.send(input.toEmail, passwordChangedBody(input));
  }

  sendEmailChangeVerificationEmail(input: EmailChangeVerificationMailInput): Promise<void> {
    return this.send(input.toEmail, emailChangeVerificationBody(input));
  }

  sendEmailChangedNotice(input: EmailChangedNoticeInput): Promise<void> {
    return this.send(input.toEmail, emailChangedNoticeBody(input));
  }

  private async send(toEmail: string, body: MailBody): Promise<void> {
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
