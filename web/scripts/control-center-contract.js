const CAPABILITY_PERMISSIONS = Object.freeze({
  moderation: Object.freeze({
    reportsList: "moderation.reports.view",
    reportsDetail: "moderation.reports.view",
    reportsContext: "moderation.context.view",
    reportsAssign: "moderation.reports.assign",
    reportsTransition: "moderation.reports.transition",
    sanctionsByUser: "moderation.reports.view",
    sanctionsMessageMute: "moderation.sanctions.message_mute",
    sanctionsInteractionRestriction:
      "moderation.sanctions.interaction_restriction",
    sanctionsAccountSuspension: "moderation.sanctions.account_suspension",
    sanctionsRevoke: "moderation.sanctions.revoke",
    auditList: "admin.audit.view",
  }),
  administration: Object.freeze({
    usersList: "admin.users.view",
    usersDetail: "admin.users.view",
    usersUpdate: "admin.users.edit",
    usersRevokeSessions: "admin.users.sessions.revoke",
    usersForcePasswordReset: "admin.users.force_password_reset",
    usersResetMedia: "admin.users.reset_media",
    channelsList: "admin.channels.view",
    channelsCreate: "admin.channels.create",
    channelsUpdate: "admin.channels.update",
    channelsArchive: "admin.channels.archive",
    channelsRestore: "admin.channels.restore",
    rolesView: "admin.roles.view",
    rolesAssignModerator: "admin.roles.assign_moderator",
    rolesRevokeModerator: "admin.roles.revoke_moderator",
    settingsRead: "admin.settings.view",
    settingsUpdate: "admin.settings.update",
    securityAuditList: "admin.audit.view",
  }),
  owner: Object.freeze({
    adminsAssign: "owner.admins.assign",
    adminsRevoke: "owner.admins.revoke",
    ownershipTransfer: "owner.ownership.transfer",
    protectedSettings: "owner.security_settings.update",
  }),
});

export const ControlCenterCapabilities = CAPABILITY_PERMISSIONS;

export const CONTROL_CENTER_TABS = Object.freeze([
  Object.freeze({ id: "reports", group: "moderation", capability: "moderation.reportsList" }),
  Object.freeze({
    id: "moderation-audit",
    group: "moderation",
    capability: "moderation.auditList",
  }),
  Object.freeze({ id: "users", group: "administration", capability: "administration.usersList" }),
  Object.freeze({
    id: "channels",
    group: "administration",
    capability: "administration.channelsList",
  }),
  Object.freeze({ id: "roles", group: "administration", capability: "administration.rolesView" }),
  Object.freeze({
    id: "settings",
    group: "administration",
    capability: "administration.settingsRead",
  }),
  Object.freeze({
    id: "security-audit",
    group: "administration",
    capability: "administration.securityAuditList",
  }),
  Object.freeze({
    id: "ownership-transfer",
    group: "owner",
    capability: "owner.ownershipTransfer",
  }),
]);

const CONTROL_CENTER_TAB_IDS = new Set(CONTROL_CENTER_TABS.map((tab) => tab.id));

function capabilityValue(capabilities, path) {
  const [group, name] = path.split(".");
  return !!capabilities?.[group]?.[name];
}

export function isKnownControlCenterTab(tab) {
  return typeof tab === "string" && CONTROL_CENTER_TAB_IDS.has(tab);
}

export function canAccessControlCenterTab(capabilities, tab) {
  const definition = CONTROL_CENTER_TABS.find((item) => item.id === tab);
  return !!definition && capabilityValue(capabilities, definition.capability);
}

export function getAllowedControlCenterTabs(capabilities) {
  return CONTROL_CENTER_TABS
    .filter((tab) => capabilityValue(capabilities, tab.capability))
    .map((tab) => tab.id);
}

export function canAccessControlCenterGroup(capabilities, group) {
  return CONTROL_CENTER_TABS.some((tab) =>
    tab.group === group && capabilityValue(capabilities, tab.capability)
  );
}

export function getActiveCapabilities(operator) {
  const permissions = new Set(operator?.permissions || []);
  const mapGroup = (group) =>
    Object.fromEntries(
      Object.entries(group).map(([key, permission]) => [
        key,
        permissions.has(permission),
      ]),
    );
  return {
    operator: { identity: !!operator },
    moderation: mapGroup(CAPABILITY_PERMISSIONS.moderation),
    administration: mapGroup(CAPABILITY_PERMISSIONS.administration),
    owner: mapGroup(CAPABILITY_PERMISSIONS.owner),
  };
}

export function hasPermission(operator, permission) {
  return Array.isArray(operator?.permissions) &&
    operator.permissions.includes(permission);
}
