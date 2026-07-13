import type {
  AdminChannel,
  AdminUser,
  CursorPage,
  SettingKey,
  SettingRecord,
  SettingValue,
  SystemRole,
} from "./administration.entity.ts";

export interface AdminUserFilters {
  readonly search?: string;
  readonly role?: SystemRole;
  readonly verified?: boolean;
  readonly suspended?: boolean;
  readonly disabled?: boolean;
}

export interface AdministrationRepository {
  getRole(userId: string): SystemRole | null;
  setRoleByEmailIfNoOwner(email: string, role: "owner"): boolean;
  countOwners(): number;
  compareAndSetRole(userId: string, expected: SystemRole, next: SystemRole): boolean;
  transferOwnership(
    actorId: string,
    targetId: string,
    expectedActor: SystemRole,
    expectedTarget: SystemRole,
  ): boolean;
  listUsers(
    filters: AdminUserFilters,
    cursor: string | null,
    limit: number,
    nowIso: string,
  ): CursorPage<AdminUser>;
  findAdminUser(id: string, nowIso: string): AdminUser | null;
  updateUser(
    id: string,
    expectedVersion: number,
    patch: { displayName?: string; bio?: string; disabledAt?: string | null },
  ): AdminUser | null;
  setMustResetPassword(id: string, value: boolean): boolean;
  resetAvatar(id: string): string | null | undefined;
  resetCover(id: string): string | null | undefined;
  listChannels(
    state: "active" | "archived" | null,
    cursor: string | null,
    limit: number,
  ): CursorPage<AdminChannel>;
  findAdminChannel(id: string): AdminChannel | null;
  createChannel(input: {
    id: string;
    slug: string;
    name: string;
    description: string;
    sortOrder: number;
  }): AdminChannel;
  updateChannel(
    id: string,
    expectedVersion: number,
    patch: { name?: string; description?: string; sortOrder?: number },
  ): AdminChannel | null;
  setChannelState(
    id: string,
    expectedVersion: number,
    expectedState: "active" | "archived",
    nextState: "active" | "archived",
  ): AdminChannel | null;
  listSettings(): SettingRecord[];
  findSetting(key: SettingKey): SettingRecord | null;
  updateSetting(
    key: SettingKey,
    expectedVersion: number,
    value: SettingValue,
    actorId: string,
  ): SettingRecord | null;
}
