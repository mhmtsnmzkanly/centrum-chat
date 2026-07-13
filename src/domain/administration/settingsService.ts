import type { Permission } from "./administration.entity.ts";
import type { SettingKey, SettingRecord, SettingValue } from "./administration.entity.ts";
import type { AdministrationRepository } from "./administrationRepository.port.ts";
import type { AdministrationPermissionService } from "./permissionRegistry.ts";
import {
  SettingNotSupportedError,
  SettingUpdateConflictError,
  SettingValidationError,
} from "./administrationErrors.ts";

interface Definition {
  readonly type: "boolean" | "integer" | "string";
  readonly defaultValue: SettingValue;
  readonly permission: Permission;
  readonly min?: number;
  readonly max?: number;
}

export const SETTING_DEFINITIONS: Readonly<Record<SettingKey, Definition>> = {
  registration_enabled: {
    type: "boolean",
    defaultValue: true,
    permission: "admin.registration_policy.update",
  },
  email_verification_required: {
    type: "boolean",
    defaultValue: true,
    permission: "owner.security_settings.update",
  },
  maintenance_mode: {
    type: "boolean",
    defaultValue: false,
    permission: "admin.settings.update",
  },
  max_message_length: {
    type: "integer",
    defaultValue: 2000,
    permission: "admin.settings.update",
    min: 100,
    max: 10000,
  },
  max_group_members: {
    type: "integer",
    defaultValue: 25,
    permission: "admin.settings.update",
    min: 3,
    max: 100,
  },
  max_upload_size_bytes: {
    type: "integer",
    defaultValue: 26214400,
    permission: "admin.settings.update",
    min: 1024,
    max: 104857600,
  },
  max_avatar_size_bytes: {
    type: "integer",
    defaultValue: 5242880,
    permission: "admin.settings.update",
    min: 1024,
    max: 20971520,
  },
  max_cover_size_bytes: {
    type: "integer",
    defaultValue: 5242880,
    permission: "admin.settings.update",
    min: 1024,
    max: 20971520,
  },
  allow_group_creation: {
    type: "boolean",
    defaultValue: true,
    permission: "admin.feature_flags.update",
  },
  allow_new_dm: {
    type: "boolean",
    defaultValue: true,
    permission: "admin.feature_flags.update",
  },
  default_channel_id: {
    type: "string",
    defaultValue: "11111111-1111-4111-8111-111111111111",
    permission: "admin.settings.update",
  },
};

export class SettingsService {
  constructor(
    private readonly repository: AdministrationRepository,
    private readonly permissions: AdministrationPermissionService,
    private readonly infrastructureMaxima: {
      readonly upload: number;
      readonly avatar: number;
      readonly cover: number;
    },
  ) {}

  get<T extends SettingValue>(key: SettingKey): T {
    const row = this.repository.findSetting(key);
    return (row?.value ?? SETTING_DEFINITIONS[key].defaultValue) as T;
  }

  list(actorId: string) {
    this.permissions.require(actorId, "admin.settings.view");
    const rows = new Map(this.repository.listSettings().map((row) => [row.key, row]));
    return Object.entries(SETTING_DEFINITIONS).map(([rawKey, definition]) => {
      const key = rawKey as SettingKey;
      const row = rows.get(key);
      return {
        key,
        type: definition.type,
        value: row?.value ?? definition.defaultValue,
        defaultValue: definition.defaultValue,
        version: row?.version ?? 0,
        permission: definition.permission,
        restartRequired: false,
      };
    });
  }

  update(actorId: string, rawKey: string, expectedVersion: number, value: unknown): SettingRecord {
    if (!(rawKey in SETTING_DEFINITIONS)) {
      throw new SettingNotSupportedError("This setting is not supported.");
    }
    const key = rawKey as SettingKey;
    const definition = SETTING_DEFINITIONS[key];
    this.permissions.require(actorId, definition.permission);
    this.validate(key, definition, value);
    const updated = this.repository.updateSetting(
      key,
      expectedVersion,
      value as SettingValue,
      actorId,
    );
    if (!updated) throw new SettingUpdateConflictError("The setting changed concurrently.");
    return updated;
  }

  effectiveUploadLimit(
    key: "max_upload_size_bytes" | "max_avatar_size_bytes" | "max_cover_size_bytes",
  ): number {
    const infrastructure = key === "max_upload_size_bytes"
      ? this.infrastructureMaxima.upload
      : key === "max_avatar_size_bytes"
      ? this.infrastructureMaxima.avatar
      : this.infrastructureMaxima.cover;
    return Math.min(this.get<number>(key), infrastructure);
  }

  private validate(key: SettingKey, definition: Definition, value: unknown): void {
    if (
      (definition.type === "boolean" && typeof value !== "boolean") ||
      (definition.type === "integer" && (!Number.isInteger(value) || typeof value !== "number")) ||
      (definition.type === "string" && typeof value !== "string")
    ) {
      throw new SettingValidationError("The setting value has the wrong type.");
    }
    if (
      typeof value === "number" &&
      (value < (definition.min ?? value) || value > (definition.max ?? value))
    ) {
      throw new SettingValidationError("The setting value is outside its allowed bounds.");
    }
    if (key === "default_channel_id") {
      const channel = this.repository.findAdminChannel(value as string);
      if (!channel || channel.state !== "active") {
        throw new SettingValidationError("The default channel must be an active channel.");
      }
    }
  }
}
