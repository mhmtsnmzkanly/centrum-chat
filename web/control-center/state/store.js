import { ControlCenterApi } from "../api/controlCenterApi.js";
import { getActiveCapabilities } from "../api/contract.js";

const DEFAULT_STATE = {
  currentTab: "reports", // reports, sanctions, moderation-audit, users, channels, roles, settings, security-audit, admin-management, ownership-transfer
  operator: null,
  capabilities: null,

  // Moderation Queue
  reports: [],
  nextReportsCursor: null,
  reportsLoading: false,
  reportsError: null,
  reportsFilters: {
    status: "open",
    targetType: "",
    assignedToMe: false,
  },

  // Selected Report
  selectedReportId: null,
  selectedReportDetails: null,
  selectedReportContext: null, // { target, surrounding, uploader }
  selectedReportLoading: false,
  selectedReportError: null,

  // User Profile Sanction History overlay / details
  userSanctions: [],
  userSanctionsLoading: false,
  userSanctionsError: null,

  // Users Management
  users: [],
  nextUsersCursor: null,
  usersLoading: false,
  usersError: null,
  usersFilters: {
    search: "",
    role: "",
  },
  selectedUserId: null,
  selectedUserDetails: null,
  selectedUserLoading: false,
  selectedUserError: null,

  // Channels Management
  channels: [],
  channelsLoading: false,
  channelsError: null,
  selectedChannelId: null,
  selectedChannelDetails: null,
  selectedChannelLoading: false,
  selectedChannelError: null,

  // Roles Management
  roleOptions: [],
  rolesLoading: false,
  rolesError: null,

  // System Settings
  settings: null,
  settingsLoading: false,
  settingsError: null,

  // Audit Events
  auditEvents: [],
  nextAuditCursor: null,
  auditLoading: false,
  auditError: null,
  auditFilters: {
    actionCode: "",
    actorUserId: "",
    targetType: "",
    targetId: "",
  },

  // UI state
  pendingActions: {},
  globalError: null,
  accessDenied: false,
};

class Store {
  constructor() {
    this.state = { ...DEFAULT_STATE };
    this.listeners = new Set();
    this.requestIds = {
      reports: 0,
      detail: 0,
      userSanctions: 0,
      users: 0,
      userDetail: 0,
      channels: 0,
      settings: 0,
      audit: 0,
    };
  }

  getState() {
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // A failed view listener must not interrupt state cleanup or other views.
      }
    }
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.notify();
  }

  clearSensitiveState() {
    for (const key of Object.keys(this.requestIds)) this.requestIds[key]++;
    this.update({
      operator: null,
      capabilities: null,
      reports: [],
      nextReportsCursor: null,
      reportsLoading: false,
      reportsError: null,
      selectedReportId: null,
      selectedReportDetails: null,
      selectedReportContext: null,
      selectedReportLoading: false,
      selectedReportError: null,
      userSanctions: [],
      userSanctionsLoading: false,
      userSanctionsError: null,
      users: [],
      nextUsersCursor: null,
      usersLoading: false,
      usersError: null,
      selectedUserId: null,
      selectedUserDetails: null,
      selectedUserLoading: false,
      selectedUserError: null,
      channels: [],
      channelsLoading: false,
      channelsError: null,
      selectedChannelId: null,
      selectedChannelDetails: null,
      selectedChannelLoading: false,
      selectedChannelError: null,
      roleOptions: [],
      rolesLoading: false,
      rolesError: null,
      settings: null,
      settingsLoading: false,
      settingsError: null,
      auditEvents: [],
      nextAuditCursor: null,
      auditLoading: false,
      auditError: null,
      pendingActions: {},
      accessDenied: true,
    });
  }

  setPending(actionId, isPending) {
    const pendingActions = { ...this.state.pendingActions };
    if (isPending) {
      pendingActions[actionId] = true;
    } else {
      delete pendingActions[actionId];
    }
    this.update({ pendingActions });
  }

  isPending(actionId) {
    return !!this.state.pendingActions[actionId];
  }

  async loadOperator() {
    try {
      const response = await ControlCenterApi.getOperator();
      const operator = { ...response.user, ...response };
      delete operator.user;
      const capabilities = getActiveCapabilities(operator);
      const allowed = response.areas?.moderation ||
        response.areas?.administration ||
        response.areas?.owner;
      if (!allowed) return this.clearSensitiveState();
      this.update({ operator, capabilities, accessDenied: false });
    } catch (_err) {
      this.clearSensitiveState();
    }
  }

  async handleForbidden() {
    this.clearSensitiveState();
    await this.loadOperator();
  }

  // ==========================================
  // REPORTS ACTIONS
  // ==========================================
  async loadReports(cursor = null, isAppend = false) {
    const reqId = ++this.requestIds.reports;
    this.update({ reportsLoading: true, reportsError: null });

    try {
      const result = await ControlCenterApi.listReports({
        ...this.state.reportsFilters,
        cursor,
      });
      if (reqId !== this.requestIds.reports) return;

      const reports = isAppend
        ? [...this.state.reports, ...result.items]
        : result.items;
      this.update({
        reports,
        nextReportsCursor: result.nextCursor,
        reportsLoading: false,
      });
    } catch (err) {
      if (reqId !== this.requestIds.reports) return;
      this.update({ reportsLoading: false, reportsError: err });
    }
  }

  async loadReportDetails(reportId) {
    if (!reportId) {
      this.update({
        selectedReportId: null,
        selectedReportDetails: null,
        selectedReportContext: null,
        selectedReportError: null,
      });
      return;
    }

    const reqId = ++this.requestIds.detail;
    this.update({
      selectedReportId: reportId,
      selectedReportLoading: true,
      selectedReportError: null,
      selectedReportDetails: null,
      selectedReportContext: null,
    });

    try {
      const detailRes = await ControlCenterApi.getReport(reportId);
      if (reqId !== this.requestIds.detail) return;

      const contextRes = await ControlCenterApi.getReportContext(reportId);
      if (reqId !== this.requestIds.detail) return;

      this.update({
        selectedReportDetails: detailRes.report,
        selectedReportContext: contextRes,
        userSanctions: contextRes.sanctions || [],
        selectedReportLoading: false,
      });
    } catch (err) {
      if (reqId !== this.requestIds.detail) return;
      this.update({ selectedReportLoading: false, selectedReportError: err });
    }
  }

  async loadUserSanctions(userId) {
    const reqId = ++this.requestIds.userSanctions;
    this.update({ userSanctionsLoading: true, userSanctionsError: null });

    try {
      const result = await ControlCenterApi.listUserSanctions(userId, {
        activeOnly: false,
      });
      if (reqId !== this.requestIds.userSanctions) return;

      this.update({
        userSanctions: result.items,
        userSanctionsLoading: false,
      });
    } catch (err) {
      if (reqId !== this.requestIds.userSanctions) return;
      this.update({ userSanctionsLoading: false, userSanctionsError: err });
    }
  }

  async assignReport(reportId, expectedAssigneeId, moderatorId) {
    const actionId = `assign-${reportId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      const res = await ControlCenterApi.assignReport(
        reportId,
        expectedAssigneeId,
        moderatorId,
      );
      // Update selected report if it matches
      if (this.state.selectedReportId === reportId) {
        this.update({ selectedReportDetails: res.report });
      }
      // Reload queue list
      await this.loadReports();
    } catch (error) {
      if (error.status === 409 && this.state.selectedReportId === reportId) {
        await this.loadReportDetails(reportId);
      }
      throw error;
    } finally {
      this.setPending(actionId, false);
    }
  }

  async transitionReport(reportId, expectedStatus, nextStatus) {
    const actionId = `transition-${reportId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      const res = await ControlCenterApi.transitionReport(
        reportId,
        expectedStatus,
        nextStatus,
      );
      if (this.state.selectedReportId === reportId) {
        this.update({ selectedReportDetails: res.report });
      }
      await this.loadReports();
    } catch (error) {
      if (error.status === 409 && this.state.selectedReportId === reportId) {
        await this.loadReportDetails(reportId);
      }
      throw error;
    } finally {
      this.setPending(actionId, false);
    }
  }

  async applySanction(userId, sanctionData) {
    const actionId = `apply-sanction-${userId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      await ControlCenterApi.applySanction(userId, sanctionData);
      // Reload user sanctions if matching
      if (this.state.selectedUserDetails?.id === userId) {
        await this.loadUserSanctions(userId);
      }
      if (
        this.state.selectedReportContext?.target?.id === userId ||
        this.state.selectedReportContext?.uploader?.id === userId
      ) {
        await this.loadUserSanctions(userId);
      }
    } finally {
      this.setPending(actionId, false);
    }
  }

  async revokeSanction(sanctionId, userId, reason) {
    const actionId = `revoke-sanction-${sanctionId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      await ControlCenterApi.revokeSanction(sanctionId, reason);
      await this.loadUserSanctions(userId);
    } finally {
      this.setPending(actionId, false);
    }
  }

  // ==========================================
  // USERS ACTIONS
  // ==========================================
  async loadUsers(cursor = null, isAppend = false) {
    const reqId = ++this.requestIds.users;
    this.update({ usersLoading: true, usersError: null });

    try {
      const result = await ControlCenterApi.listUsers({
        ...this.state.usersFilters,
        cursor,
      });
      if (reqId !== this.requestIds.users) return;

      const users = isAppend
        ? [...this.state.users, ...result.items]
        : result.items;
      this.update({
        users,
        nextUsersCursor: result.nextCursor,
        usersLoading: false,
      });
    } catch (err) {
      if (reqId !== this.requestIds.users) return;
      this.update({ usersLoading: false, usersError: err });
    }
  }

  async loadUserDetails(userId) {
    if (!userId) {
      this.update({
        selectedUserId: null,
        selectedUserDetails: null,
        selectedUserError: null,
      });
      return;
    }

    const reqId = ++this.requestIds.userDetail;
    this.update({
      selectedUserId: userId,
      selectedUserLoading: true,
      selectedUserError: null,
      selectedUserDetails: null,
    });

    try {
      const res = await ControlCenterApi.getUser(userId);
      if (reqId !== this.requestIds.userDetail) return;

      this.update({
        selectedUserDetails: res.user,
        selectedUserLoading: false,
      });
      // Contextual loading of user's sanctions
      await this.loadUserSanctions(userId);
    } catch (err) {
      if (reqId !== this.requestIds.userDetail) return;
      this.update({ selectedUserLoading: false, selectedUserError: err });
    }
  }

  async updateUser(userId, expectedVersion, patch) {
    const actionId = `update-user-${userId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);
    try {
      const result = await ControlCenterApi.updateUser(
        userId,
        expectedVersion,
        patch,
      );
      if (this.state.selectedUserId === userId) {
        this.update({ selectedUserDetails: result.user });
      }
      await this.loadUsers();
      return result.user;
    } finally {
      this.setPending(actionId, false);
    }
  }

  async updateUserRole(userId, expectedRole, role) {
    const actionId = `update-role-${userId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      if (role === "user") {
        await ControlCenterApi.revokeRole(userId, expectedRole, expectedRole);
      } else {
        await ControlCenterApi.assignRole(userId, expectedRole, role);
      }
      if (this.state.selectedUserId === userId) {
        await this.loadUserDetails(userId);
      }
      await this.loadUsers();
    } finally {
      this.setPending(actionId, false);
    }
  }

  async revokeUserSessions(userId) {
    const actionId = `revoke-sessions-${userId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      await ControlCenterApi.revokeUserSessions(userId);
      if (this.state.selectedUserId === userId) {
        await this.loadUserDetails(userId);
      }
    } finally {
      this.setPending(actionId, false);
    }
  }

  async forcePasswordReset(userId) {
    const actionId = `force-pw-reset-${userId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      await ControlCenterApi.forcePasswordReset(userId);
      if (this.state.selectedUserId === userId) {
        await this.loadUserDetails(userId);
      }
    } finally {
      this.setPending(actionId, false);
    }
  }

  async resetUserAvatar(userId) {
    const actionId = `reset-avatar-${userId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      await ControlCenterApi.resetUserAvatar(userId);
      if (this.state.selectedUserId === userId) {
        await this.loadUserDetails(userId);
      }
    } finally {
      this.setPending(actionId, false);
    }
  }

  async resetUserCover(userId) {
    const actionId = `reset-cover-${userId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      await ControlCenterApi.resetUserCover(userId);
      if (this.state.selectedUserId === userId) {
        await this.loadUserDetails(userId);
      }
    } finally {
      this.setPending(actionId, false);
    }
  }

  // ==========================================
  // CHANNELS ACTIONS
  // ==========================================
  async loadChannels(state = null, cursor = null, isAppend = false) {
    const reqId = ++this.requestIds.channels;
    this.update({ channelsLoading: true, channelsError: null });

    try {
      const result = await ControlCenterApi.listChannels({ state, cursor });
      if (reqId !== this.requestIds.channels) return;

      this.update({
        channels: isAppend
          ? [...this.state.channels, ...result.items]
          : result.items,
        nextChannelsCursor: result.nextCursor,
        channelsLoading: false,
      });
    } catch (err) {
      if (reqId !== this.requestIds.channels) return;
      this.update({ channelsLoading: false, channelsError: err });
    }
  }

  async createChannel(channelData) {
    const actionId = "create-channel";
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      await ControlCenterApi.createChannel(channelData);
      await this.loadChannels();
    } finally {
      this.setPending(actionId, false);
    }
  }

  async updateChannel(channelId, expectedVersion, fields) {
    const actionId = `update-channel-${channelId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      const res = await ControlCenterApi.updateChannel(
        channelId,
        expectedVersion,
        fields,
      );
      if (this.state.selectedChannelId === channelId) {
        this.update({ selectedChannelDetails: res.channel });
      }
      await this.loadChannels();
    } finally {
      this.setPending(actionId, false);
    }
  }

  async archiveChannel(channelId, expectedVersion) {
    const actionId = `archive-channel-${channelId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      const res = await ControlCenterApi.archiveChannel(
        channelId,
        expectedVersion,
      );
      if (this.state.selectedChannelId === channelId) {
        this.update({ selectedChannelDetails: res.channel });
      }
      await this.loadChannels();
    } finally {
      this.setPending(actionId, false);
    }
  }

  async restoreChannel(channelId, expectedVersion) {
    const actionId = `restore-channel-${channelId}`;
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      const res = await ControlCenterApi.restoreChannel(
        channelId,
        expectedVersion,
      );
      if (this.state.selectedChannelId === channelId) {
        this.update({ selectedChannelDetails: res.channel });
      }
      await this.loadChannels();
    } finally {
      this.setPending(actionId, false);
    }
  }

  // ==========================================
  // SETTINGS ACTIONS
  // ==========================================
  async loadSettings() {
    const reqId = ++this.requestIds.settings;
    this.update({ settingsLoading: true, settingsError: null });

    try {
      const res = await ControlCenterApi.getSettings();
      if (reqId !== this.requestIds.settings) return;

      this.update({
        settings: res.settings,
        settingsLoading: false,
      });
    } catch (err) {
      if (reqId !== this.requestIds.settings) return;
      this.update({ settingsLoading: false, settingsError: err });
    }
  }

  async updateSettings(changes) {
    const actionId = "update-settings";
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      const settings = [...(this.state.settings || [])];
      for (const change of changes) {
        const res = await ControlCenterApi.updateSetting(
          change.key,
          change.expectedVersion,
          change.value,
        );
        const index = settings.findIndex((setting) =>
          setting.key === change.key
        );
        if (index >= 0) {
          settings[index] = { ...settings[index], ...res.setting };
        }
      }
      this.update({ settings });
    } finally {
      this.setPending(actionId, false);
    }
  }

  // ==========================================
  // OWNER ROLE ACTIONS
  // ==========================================
  async transferOwnership(targetUserId, expectedTargetRole) {
    const actionId = "transfer-ownership";
    if (this.isPending(actionId)) return;
    this.setPending(actionId, true);

    try {
      await ControlCenterApi.transferOwnership(
        targetUserId,
        "owner",
        expectedTargetRole,
      );
      await this.loadOperator();
      await this.loadUsers();
    } finally {
      this.setPending(actionId, false);
    }
  }

  // ==========================================
  // AUDIT ACTIONS
  // ==========================================
  async loadAuditEvents(cursor = null, isAppend = false) {
    const reqId = ++this.requestIds.audit;
    this.update({ auditLoading: true, auditError: null });

    try {
      const result = await ControlCenterApi.listAuditEvents({
        ...this.state.auditFilters,
        cursor,
      });
      if (reqId !== this.requestIds.audit) return;

      const auditEvents = isAppend
        ? [...this.state.auditEvents, ...result.items]
        : result.items;
      this.update({
        auditEvents,
        nextAuditCursor: result.nextCursor,
        auditLoading: false,
      });
    } catch (err) {
      if (reqId !== this.requestIds.audit) return;
      this.update({ auditLoading: false, auditError: err });
    }
  }
}

const storeInstance = new Store();
globalThis.controlCenterStore = storeInstance;

export const controlCenterStore = storeInstance;
