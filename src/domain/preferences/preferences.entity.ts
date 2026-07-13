export type DmPrivacy = "everyone" | "group_members" | "no_one";
export type GroupPrivacy = "everyone" | "dm_contacts" | "no_one";
export type Theme = "dark" | "light";

/** Wire shape `Preferences` from docs/03-websocket-events.md. */
export interface Preferences {
  readonly sound: boolean;
  readonly desktopNotifications: boolean;
  readonly dmPrivacy: DmPrivacy;
  readonly groupPrivacy: GroupPrivacy;
  readonly theme: Theme;
}
