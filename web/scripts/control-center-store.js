import { ControlCenterApi } from "./control-center-api.js";
import { getActiveCapabilities } from "./control-center-contract.js";
import { createStore } from "./lime-csr.js";
import { formatDate } from "./control-center-common.js";
import { getLocale, t, tp } from "./i18n.js";

const DEFAULT_STATE = {
  locale: getLocale(),
  currentTab: "reports", // reports, moderation-audit, users, channels, roles, settings, security-audit, ownership-transfer
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
  // Two-way draft behind the editable-account-fields form; seeded per selection.
  userEditDraft: { displayName: "", bio: "", disabled: false },

  // Channels Management
  channels: [],
  channelsLoading: false,
  channelsError: null,

  // System Settings
  settings: null,
  settingsState: {},
  renderedVersions: {},
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
    this.store = createStore(DEFAULT_STATE);
    this.state = this.store.get();
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

    // Dynamic Lists computed properties:
    // 1. reportsList
    this.store.computed("reportsList", ["reports", "selectedReportId"], () => {
      const reports = this.store.get("reports") || [];
      const selectedId = this.store.get("selectedReportId");
      return reports.map(r => ({
        ...r,
        activeClass: r.id === selectedId ? "active" : "",
        badgeClass: `report-badge ${r.status}`,
        statusText: r.status.replace("_", " "),
        targetTypeUpper: r.targetType.toUpperCase(),
        reasonCodeUpper: r.reasonCode ? r.reasonCode.toUpperCase() : "",
        formattedDate: formatDate(r.createdAt),
      }));
    });

    // 2. usersList
    this.store.computed("usersList", ["users", "selectedUserId"], () => {
      const users = this.store.get("users") || [];
      const selectedId = this.store.get("selectedUserId");
      return users.map(u => ({
        ...u,
        activeClass: u.id === selectedId ? "active" : "",
        roleUpper: (u.role || "user").toUpperCase(),
        displayNameOrUsername: u.displayName || u.username,
        email: u.email || "No email",
      }));
    });

    // 3. userSanctionsList
    this.store.computed("userSanctionsList", ["userSanctions", "capabilities", "locale"], () => {
      const userSanctions = this.store.get("userSanctions") || [];
      const canRevokeSanctions = !!this.store.get("capabilities")?.moderation
        .sanctionsRevoke;
      return userSanctions.map(s => {
        const isRevoked = !!s.revokedAt;
        const isExpired = !!s.expiresAt && new Date(s.expiresAt) < new Date();
        const statusText = isRevoked
          ? t("control.status.revoked")
          : (isExpired ? t("control.status.expired") : t("control.status.active"));
        const badgeClass = isRevoked ? "bg-secondary" : (isExpired ? "bg-secondary" : "bg-danger");
        return {
          ...s,
          typeDisplay: s.type.replace("_", " ").toUpperCase(),
          statusText,
          badgeClass,
          expiresFormatted: s.expiresAt ? formatDate(s.expiresAt) : t("control.status.permanent"),
          canRevoke: canRevokeSanctions && !isRevoked && !isExpired,
        };
      });
    });

    // 4. moderationAuditEvents
    this.store.computed("moderationAuditEvents", ["auditEvents", "locale"], () => {
      const events = this.store.get("auditEvents") || [];
      const codes = ["report.assign", "report.status.transition", "sanction.apply", "sanction.revoke"];
      return events.filter(e => codes.includes(e.actionCode)).map(e => ({
        ...e,
        actionUpper: e.actionCode ? e.actionCode.toUpperCase() : "",
        targetTypeUpper: e.targetType ? e.targetType.toUpperCase() : "",
        targetDisplay: `${e.targetType || "N/A"}: ${e.targetId || "N/A"}`,
        formattedDate: formatDate(e.createdAt),
        outcomeClass: e.outcome === "success" ? "bg-success-subtle text-success border border-success-subtle" : "bg-danger-subtle text-danger border border-danger-subtle",
        metadataFormatted: JSON.stringify(e.metadata || {}, null, 2),
      }));
    });

    // 6. securityAuditEvents
    this.store.computed("securityAuditEvents", ["auditEvents", "locale"], () => {
      const events = this.store.get("auditEvents") || [];
      const codes = ["report.assign", "report.status.transition", "sanction.apply", "sanction.revoke"];
      return events.filter(e => !codes.includes(e.actionCode)).map(e => ({
        ...e,
        actionUpper: e.actionCode ? e.actionCode.toUpperCase() : "",
        targetTypeUpper: e.targetType ? e.targetType.toUpperCase() : "",
        targetDisplay: `${e.targetType || "N/A"}: ${e.targetId || "N/A"}`,
        formattedDate: formatDate(e.createdAt),
        outcomeClass: e.outcome === "success" ? "bg-success-subtle text-success border border-success-subtle" : "bg-danger-subtle text-danger border border-danger-subtle",
        metadataFormatted: JSON.stringify(e.metadata || {}, null, 2),
      }));
    });

    // 7. count computed labels
    this.store.computed("moderationAuditEventsCountLabel", ["moderationAuditEvents", "locale"], () => {
      return t("control.events.count", {
        count: (this.store.get("moderationAuditEvents") || []).length,
      });
    });
    this.store.computed("securityAuditEventsCountLabel", ["securityAuditEvents", "locale"], () => {
      return t("control.events.count", {
        count: (this.store.get("securityAuditEvents") || []).length,
      });
    });
    this.store.computed("moderationAuditEmpty", ["moderationAuditEvents"], () => {
      return (this.store.get("moderationAuditEvents") || []).length === 0;
    });
    this.store.computed("securityAuditEmpty", ["securityAuditEvents"], () => {
      return (this.store.get("securityAuditEvents") || []).length === 0;
    });

    // 8. Shell / top bar / operator card
    this.store.computed("showShell", ["operator", "accessDenied"], () => {
      return !!this.store.get("operator") && !this.store.get("accessDenied");
    });

    const TAB_TITLE_KEYS = {
      reports: "control.tab.reports",
      "moderation-audit": "control.tab.moderationAudit",
      users: "control.tab.users",
      channels: "control.tab.channels",
      roles: "control.tab.roles",
      settings: "control.tab.settings",
      "security-audit": "control.tab.securityAudit",
      "ownership-transfer": "control.tab.ownership",
    };
    this.store.computed("workspaceTitleText", ["currentTab", "locale"], () => {
      const key = TAB_TITLE_KEYS[this.store.get("currentTab")];
      return key ? t(key) : "Control Center";
    });

    this.store.computed("operatorAvatarText", ["operator"], () => {
      const op = this.store.get("operator");
      const name = op?.displayName || op?.username || "OP";
      return name.slice(0, 2).toUpperCase();
    });
    this.store.computed("operatorRoleUpper", ["operator"], () => {
      const op = this.store.get("operator");
      return (op?.role || "operator").toUpperCase();
    });
    this.store.computed("operatorBadgeClass", ["operator"], () => {
      const badges = {
        owner: "bg-danger",
        admin: "bg-primary",
        moderator: "bg-info text-dark",
      };
      return badges[this.store.get("operator")?.role] || "bg-secondary";
    });

    // 9. Reports queue + investigation helpers
    this.store.computed("reportsListCountLabel", ["reports", "locale"], () => {
      const count = (this.store.get("reports") || []).length;
      return tp("control.reports.count", count);
    });
    this.store.computed("reportsListEmpty", ["reports", "reportsLoading"], () => {
      return !this.store.get("reportsLoading") &&
        (this.store.get("reports") || []).length === 0;
    });
    this.store.computed("usersListEmpty", ["users", "usersLoading"], () => {
      return !this.store.get("usersLoading") &&
        (this.store.get("users") || []).length === 0;
    });
    this.store.computed(
      "showInvestigationPlaceholder",
      ["selectedReportLoading", "selectedReportDetails"],
      () => {
        return !this.store.get("selectedReportLoading") &&
          !this.store.get("selectedReportDetails");
      },
    );
    this.store.computed("showInvestigationLoading", ["selectedReportLoading"], () => {
      return !!this.store.get("selectedReportLoading");
    });
    this.store.computed(
      "showInvestigationDetails",
      ["selectedReportLoading", "selectedReportDetails"],
      () => {
        return !this.store.get("selectedReportLoading") &&
          !!this.store.get("selectedReportDetails");
      },
    );
    this.store.computed("showTargetContextMessage", ["selectedReportDetails"], () => {
      return this.store.get("selectedReportDetails")?.targetType === "message";
    });
    this.store.computed("showTargetContextUser", ["selectedReportDetails"], () => {
      return this.store.get("selectedReportDetails")?.targetType === "user";
    });
    this.store.computed("showTargetContextAttachment", ["selectedReportDetails"], () => {
      return this.store.get("selectedReportDetails")?.targetType === "attachment";
    });
    this.store.computed("selectedReportFormattedDate", ["selectedReportDetails"], () => {
      return formatDate(this.store.get("selectedReportDetails")?.createdAt);
    });
    this.store.computed("selectedReportStatusClass", ["selectedReportDetails"], () => {
      const status = this.store.get("selectedReportDetails")?.status || "open";
      return `badge report-badge ${status}`;
    });
    this.store.computed(
      "showAssignButton",
      ["selectedReportDetails", "operator", "capabilities"],
      () => {
        const det = this.store.get("selectedReportDetails");
        const op = this.store.get("operator");
        const caps = this.store.get("capabilities");
        return !!(caps?.moderation.reportsAssign && det && op &&
          det.assignedModeratorId !== op.id &&
          (det.status === "open" || det.status === "in_review"));
      },
    );
    this.store.computed(
      "canApplySanctions",
      ["capabilities", "selectedReportDetails"],
      () => {
        const caps = this.store.get("capabilities");
        const det = this.store.get("selectedReportDetails");
        const canApply = !!(caps && (caps.moderation.sanctionsMessageMute ||
          caps.moderation.sanctionsInteractionRestriction ||
          caps.moderation.sanctionsAccountSuspension));
        return canApply && det?.targetType === "user";
      },
    );
    this.store.computed("canRevokeSanctions", ["capabilities"], () => {
      return !!this.store.get("capabilities")?.moderation.sanctionsRevoke;
    });
  }

  get(path) {
    return this.store.get(path);
  }

  set(path, value) {
    return this.store.set(path, value);
  }

  computed(path, deps, fn) {
    return this.store.computed(path, deps, fn);
  }

  getState() {
    return this.state;
  }

  /** Path-scoped subscription (lime store semantics). Modules that mirror
   * state into imperative DOM (selects, modals) subscribe to the exact paths
   * they render instead of a whole-state listener. */
  subscribe(path, callback) {
    return this.store.subscribe(path, callback);
  }

  update(patch) {
    for (const [k, v] of Object.entries(patch)) {
      this.store.set(k, v);
    }
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
      userEditDraft: { displayName: "", bio: "", disabled: false },
      channels: [],
      channelsLoading: false,
      channelsError: null,
      settings: null,
      settingsState: {},
      renderedVersions: {},
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

  /** Maps a GET /api/control-center/me payload into operator/capability state.
   * The boot flow passes the payload it already resolved for the access check,
   * so the endpoint is only fetched once per page load. */
  applyOperator(response) {
    const allowed = response?.areas?.moderation ||
      response?.areas?.administration ||
      response?.areas?.owner;
    if (!allowed) return this.clearSensitiveState();
    const operator = { ...response.user, ...response };
    delete operator.user;
    const capabilities = getActiveCapabilities(operator);
    this.update({ operator, capabilities, accessDenied: false });
  }

  async loadOperator() {
    try {
      this.applyOperator(await ControlCenterApi.getOperator());
    } catch (_err) {
      this.clearSensitiveState();
    }
  }

  /** Called by the API layer on any 403. A single 403 can be route-scoped
   * (one capability revoked), so re-resolve the operator FIRST: a confirmed
   * loss of Control Center access ends in clearSensitiveState(), whose
   * accessDenied flag triggers the auth-page redirect; an operator that still
   * has access just gets refreshed capabilities and the page keeps working. */
  async handleForbidden() {
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

      if (!contextRes.context) contextRes.context = [];
      else {
        contextRes.context = contextRes.context.map(m => ({
          ...m,
          createdAt: formatDate(m.createdAt)
        }));
      }
      if (contextRes.target) {
        contextRes.target = {
          ...contextRes.target,
          createdAt: formatDate(contextRes.target.createdAt)
        };
      }

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
        userEditDraft: {
          displayName: res.user.displayName || "",
          bio: res.user.bio || "",
          disabled: !!res.user.accountDisabledAt,
        },
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
      await ControlCenterApi.updateChannel(
        channelId,
        expectedVersion,
        fields,
      );
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
      await ControlCenterApi.archiveChannel(
        channelId,
        expectedVersion,
      );
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
      await ControlCenterApi.restoreChannel(
        channelId,
        expectedVersion,
      );
      await this.loadChannels();
    } finally {
      this.setPending(actionId, false);
    }
  }

  async loadSettings() {
    const reqId = ++this.requestIds.settings;
    this.update({ settingsLoading: true, settingsError: null });

    try {
      const res = await ControlCenterApi.getSettings();
      if (reqId !== this.requestIds.settings) return;

      const settingsState = {};
      const renderedVersions = {};
      for (const item of res.settings) {
        settingsState[item.key] = item.value;
        renderedVersions[item.key] = item.version;
      }

      this.update({
        settings: res.settings,
        settingsState,
        renderedVersions,
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
      const settingsState = { ...this.state.settingsState };
      const renderedVersions = { ...this.state.renderedVersions };

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
        settingsState[change.key] = res.setting.value;
        renderedVersions[change.key] = res.setting.version;
      }
      this.update({ settings, settingsState, renderedVersions });
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
