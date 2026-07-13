export interface VerificationMailInput {
  readonly toEmail: string;
  readonly displayName: string;
  readonly verificationUrl: string;
}

export interface PasswordResetMailInput {
  readonly toEmail: string;
  readonly displayName: string;
  readonly resetUrl: string;
}

export interface PasswordChangedNoticeInput {
  readonly toEmail: string;
  readonly displayName: string;
}

export interface EmailChangeVerificationMailInput {
  readonly toEmail: string;
  readonly displayName: string;
  readonly verificationUrl: string;
}

export interface EmailChangedNoticeInput {
  readonly toEmail: string;
  readonly displayName: string;
  readonly newEmail: string;
}

export interface MailService {
  sendVerificationEmail(input: VerificationMailInput): Promise<void>;
  sendPasswordResetEmail(input: PasswordResetMailInput): Promise<void>;
  sendPasswordChangedNotice(input: PasswordChangedNoticeInput): Promise<void>;
  sendEmailChangeVerificationEmail(input: EmailChangeVerificationMailInput): Promise<void>;
  sendEmailChangedNotice(input: EmailChangedNoticeInput): Promise<void>;
}
