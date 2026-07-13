export interface SessionSummary {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly remembered: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string;
  readonly current: boolean;
}

export interface AccountSecurityStatus {
  readonly email: string;
  readonly emailVerifiedAt: string | null;
  readonly pendingEmail: string | null;
}
