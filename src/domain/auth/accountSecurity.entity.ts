export interface SessionSummary {
  readonly id: string;
  readonly deviceLabel: string | null;
  readonly remembered: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string;
  readonly current: boolean;
  /** Client metadata captured at login and refreshed on rotation; shown only to
   * the account owner. Null when unknown (e.g. sessions predating migration 0010). */
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** Non-null for revoked sessions listed as history until cleanup purges them. */
  readonly revokedAt: string | null;
}

export interface AccountSecurityStatus {
  readonly email: string;
  readonly emailVerifiedAt: string | null;
  readonly pendingEmail: string | null;
}
