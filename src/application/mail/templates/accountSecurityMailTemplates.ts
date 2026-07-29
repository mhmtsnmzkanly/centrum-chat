import type {
  EmailChangedNoticeInput,
  EmailChangeVerificationMailInput,
  PasswordChangedNoticeInput,
  PasswordResetMailInput,
  VerificationMailInput,
} from "../../../domain/auth/mailService.port.ts";
import { renderMailLayout } from "./renderMailLayout.ts";
import type { RenderedMailTemplate } from "./mailTemplate.types.ts";

function greeting(displayName: string): string {
  return `Hello ${displayName},`;
}

export function renderVerificationMail(input: VerificationMailInput): RenderedMailTemplate {
  return renderMailLayout({
    subject: "Verify your CentrumChat email",
    preheader: "Verify your email address to finish setting up CentrumChat.",
    title: "Verify your email",
    greeting: greeting(input.displayName),
    paragraphs: [
      "Verify your email address to finish setting up your CentrumChat account.",
      "Verification unlocks messaging, uploads, reactions and group creation.",
    ],
    action: { label: "Verify email", url: input.verificationUrl },
    securityNotice: "If you did not create a CentrumChat account, you can ignore this email.",
  });
}

export function renderPasswordResetMail(input: PasswordResetMailInput): RenderedMailTemplate {
  return renderMailLayout({
    subject: "Reset your CentrumChat password",
    preheader: "Use this link to reset your CentrumChat password.",
    title: "Reset your password",
    greeting: greeting(input.displayName),
    paragraphs: ["A password reset was requested for your CentrumChat account."],
    action: { label: "Reset password", url: input.resetUrl },
    securityNotice:
      "If you did not request a password reset, you can ignore this email. Your password will not change unless you use this link.",
  });
}

export function renderPasswordChangedNotice(
  input: PasswordChangedNoticeInput,
): RenderedMailTemplate {
  return renderMailLayout({
    subject: "Your CentrumChat password was changed",
    preheader: "Your CentrumChat password was changed successfully.",
    title: "Password changed",
    greeting: greeting(input.displayName),
    paragraphs: [
      "Your password was changed successfully.",
      "If this was not you, use the password reset flow immediately and review your active sessions.",
    ],
    securityNotice: "This is a security notification for your CentrumChat account.",
  });
}

export function renderEmailChangeVerificationMail(
  input: EmailChangeVerificationMailInput,
): RenderedMailTemplate {
  return renderMailLayout({
    subject: "Confirm your new CentrumChat email address",
    preheader: "Confirm your new email address for CentrumChat.",
    title: "Confirm your new email",
    greeting: greeting(input.displayName),
    paragraphs: [
      "Confirm this email address to complete the email change for your CentrumChat account.",
    ],
    action: { label: "Confirm new email", url: input.verificationUrl },
    securityNotice: "If you did not request this email change, you can ignore this email.",
  });
}

export function renderEmailChangedNotice(input: EmailChangedNoticeInput): RenderedMailTemplate {
  return renderMailLayout({
    subject: "Your CentrumChat email was changed",
    preheader: "Your CentrumChat login email was changed.",
    title: "Email changed",
    greeting: greeting(input.displayName),
    paragraphs: [
      `Your CentrumChat login email was changed to ${input.newEmail}.`,
      "If this was not you, use the password reset flow immediately and review your active sessions.",
    ],
    securityNotice: "This is a security notification for your CentrumChat account.",
  });
}
