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
