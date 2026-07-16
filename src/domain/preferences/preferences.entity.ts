export type DmPrivacy = "everyone" | "group_members" | "no_one";
export type GroupPrivacy = "everyone" | "dm_contacts" | "no_one";
export type Theme = "dark" | "light";
export type Locale = "en" | "tr";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "tr"];

/** Wire shape `Preferences` from docs/03-websocket-events.md. */
export interface Preferences {
  readonly sound: boolean;
  readonly desktopNotifications: boolean;
  readonly dmPrivacy: DmPrivacy;
  readonly groupPrivacy: GroupPrivacy;
  readonly theme: Theme;
  /** NULL until the user explicitly chooses an account-level interface language. */
  readonly locale: Locale | null;
}
