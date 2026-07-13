import { loadConfig } from "./shared/config/config.ts";
import { createLogger } from "./shared/logging/logger.ts";
import { openDatabase } from "./storage/db.ts";
import { SqliteTransactionManager } from "./storage/db.ts";
import { JsonCodec } from "./protocol/jsonCodec.ts";
import { RouteRegistry } from "./application/http/routeRegistry.ts";
import { HealthLiveRoute } from "./application/http/routes/health/healthLiveRoute.ts";
import { HealthReadyRoute } from "./application/http/routes/health/healthReadyRoute.ts";
import { RegisterRoute } from "./application/http/routes/auth/registerRoute.ts";
import { LoginRoute } from "./application/http/routes/auth/loginRoute.ts";
import { RefreshRoute } from "./application/http/routes/auth/refreshRoute.ts";
import { LogoutRoute } from "./application/http/routes/auth/logoutRoute.ts";
import { WebSocketHandlerRegistry } from "./application/websocket/registry.ts";
import { ConnectionManager } from "./transport/websocket/connectionManager.ts";
import { handleWsUpgrade } from "./transport/http/wsUpgrade.ts";
import { startHttpServer } from "./transport/http/httpServer.ts";
import { SqliteUserRepository } from "./storage/repositories/sqliteUserRepository.ts";
import { SqliteUserSessionRepository } from "./storage/repositories/sqliteUserSessionRepository.ts";
import { SqliteEmailVerificationTokenRepository } from "./storage/repositories/sqliteEmailVerificationTokenRepository.ts";
import { SqlitePasswordResetTokenRepository } from "./storage/repositories/sqlitePasswordResetTokenRepository.ts";
import { SqliteEmailChangeTokenRepository } from "./storage/repositories/sqliteEmailChangeTokenRepository.ts";
import { SqlitePreferencesRepository } from "./storage/repositories/sqlitePreferencesRepository.ts";
import { SqliteConversationRepository } from "./storage/repositories/sqliteConversationRepository.ts";
import { SqliteConversationMembershipRepository } from "./storage/repositories/sqliteConversationMembershipRepository.ts";
import { SqliteDirectConversationPairRepository } from "./storage/repositories/sqliteDirectConversationPairRepository.ts";
import { WebCryptoPasswordHasher } from "./domain/auth/webCryptoPasswordHasher.ts";
import { TokenService } from "./domain/auth/tokenService.ts";
import { AuthService } from "./domain/auth/authService.ts";
import { AccountPolicy } from "./domain/auth/accountPolicy.ts";
import { UserService } from "./domain/users/userService.ts";
import { PresenceService } from "./domain/presence/presenceService.ts";
import { PreferencesService } from "./domain/preferences/preferencesService.ts";
import { ChannelService } from "./domain/conversations/channelService.ts";
import { GroupService } from "./domain/conversations/groupService.ts";
import { DmService } from "./domain/conversations/dmService.ts";
import { PermissionService } from "./domain/permissions/permissionService.ts";
import { MessageService } from "./domain/messages/messageService.ts";
import { ConversationReadService } from "./domain/conversations/conversationReadService.ts";
import { RateLimiter } from "./shared/rateLimit/rateLimiter.ts";
import { SqliteMessageRepository } from "./storage/repositories/sqliteMessageRepository.ts";
import { SqliteConversationReadRepository } from "./storage/repositories/sqliteConversationReadRepository.ts";
import { SqliteReactionRepository } from "./storage/repositories/sqliteReactionRepository.ts";
import { SqliteAttachmentRepository } from "./storage/repositories/sqliteAttachmentRepository.ts";
import { SqliteNotificationRepository } from "./storage/repositories/sqliteNotificationRepository.ts";
import { ReactionService } from "./domain/reactions/reactionService.ts";
import { AttachmentService } from "./domain/attachments/attachmentService.ts";
import { NotificationService } from "./domain/notifications/notificationService.ts";
import { SearchService } from "./domain/search/searchService.ts";
import { TypingService } from "./domain/typing/typingService.ts";
import { outboundPush } from "./protocol/envelopes.ts";
import { pushToRoomAudience } from "./application/websocket/conversationFanout.ts";
import { UpdatePresenceHandler } from "./application/websocket/handlers/presence/updatePresenceHandler.ts";
import { GetProfileHandler } from "./application/websocket/handlers/profile/getProfileHandler.ts";
import { UpdateProfileHandler } from "./application/websocket/handlers/profile/updateProfileHandler.ts";
import { GetPreferencesHandler } from "./application/websocket/handlers/profile/getPreferencesHandler.ts";
import { UpdatePreferencesHandler } from "./application/websocket/handlers/profile/updatePreferencesHandler.ts";
import { ListChannelsHandler } from "./application/websocket/handlers/channels/listChannelsHandler.ts";
import { ListGroupsHandler } from "./application/websocket/handlers/groups/listGroupsHandler.ts";
import { GroupMembersHandler } from "./application/websocket/handlers/groups/groupMembersHandler.ts";
import { CreateGroupHandler } from "./application/websocket/handlers/groups/createGroupHandler.ts";
import { AddMemberHandler } from "./application/websocket/handlers/groups/addMemberHandler.ts";
import { RemoveMemberHandler } from "./application/websocket/handlers/groups/removeMemberHandler.ts";
import { LeaveGroupHandler } from "./application/websocket/handlers/groups/leaveGroupHandler.ts";
import { OpenDmHandler } from "./application/websocket/handlers/dm/openDmHandler.ts";
import { ListDmHandler } from "./application/websocket/handlers/dm/listDmHandler.ts";
import { SendMessageHandler } from "./application/websocket/handlers/messages/sendMessageHandler.ts";
import { EditMessageHandler } from "./application/websocket/handlers/messages/editMessageHandler.ts";
import { DeleteMessageHandler } from "./application/websocket/handlers/messages/deleteMessageHandler.ts";
import { MessageHistoryHandler } from "./application/websocket/handlers/messages/messageHistoryHandler.ts";
import { MarkReadHandler } from "./application/websocket/handlers/messages/markReadHandler.ts";
import { ToggleReactionHandler } from "./application/websocket/handlers/reactions/toggleReactionHandler.ts";
import { TypingStartHandler } from "./application/websocket/handlers/typing/typingStartHandler.ts";
import { TypingStopHandler } from "./application/websocket/handlers/typing/typingStopHandler.ts";
import { ListNotificationsHandler } from "./application/websocket/handlers/notifications/listNotificationsHandler.ts";
import { MarkNotificationReadHandler } from "./application/websocket/handlers/notifications/markNotificationReadHandler.ts";
import { SearchMessagesHandler } from "./application/websocket/handlers/search/searchMessagesHandler.ts";
import { SearchUsersHandler } from "./application/websocket/handlers/search/searchUsersHandler.ts";
import { UploadRoute } from "./application/http/routes/media/uploadRoute.ts";
import { AvatarRoute } from "./application/http/routes/media/avatarRoute.ts";
import { CoverRoute } from "./application/http/routes/media/coverRoute.ts";
import { ServeMediaRoute } from "./application/http/routes/media/serveMediaRoute.ts";
import { deleteMediaFile } from "./application/http/routes/media/mediaStorage.ts";
import { ChangePasswordRoute } from "./application/http/routes/auth/changePasswordRoute.ts";
import { AccountRoute } from "./application/http/routes/auth/accountRoute.ts";
import { ListSessionsRoute } from "./application/http/routes/auth/listSessionsRoute.ts";
import { RevokeSessionRoute } from "./application/http/routes/auth/revokeSessionRoute.ts";
import { RevokeOtherSessionsRoute } from "./application/http/routes/auth/revokeOtherSessionsRoute.ts";
import { ResendVerificationRoute } from "./application/http/routes/auth/resendVerificationRoute.ts";
import { CompleteEmailVerificationRoute } from "./application/http/routes/auth/completeEmailVerificationRoute.ts";
import { PasswordResetRequestRoute } from "./application/http/routes/auth/passwordResetRequestRoute.ts";
import { PasswordResetCompleteRoute } from "./application/http/routes/auth/passwordResetCompleteRoute.ts";
import { StartEmailChangeRoute } from "./application/http/routes/auth/startEmailChangeRoute.ts";
import { CompleteEmailChangeRoute } from "./application/http/routes/auth/completeEmailChangeRoute.ts";
import { StaticRoute } from "./application/http/routes/staticRoute.ts";
import { ControlCenterStaticRoute } from "./application/http/routes/controlCenterStaticRoute.ts";
import { SessionCleanupJob } from "./application/lifecycle/sessionCleanupJob.ts";
import { WebSocketLifecycleJob } from "./application/lifecycle/webSocketLifecycleJob.ts";
import { SystemPongHandler } from "./application/websocket/handlers/system/systemPongHandler.ts";
import { DevelopmentMailService } from "./application/mail/developmentMailService.ts";
import { ResendMailService } from "./application/mail/resendMailService.ts";
import { SqliteSafetyRepository } from "./storage/repositories/sqliteSafetyRepository.ts";
import { BlockPolicy, SanctionPolicy } from "./domain/safety/safetyPolicy.ts";
import { SafetyService } from "./domain/safety/safetyService.ts";
import { DevelopmentCaptchaVerifier } from "./application/captcha/developmentCaptchaVerifier.ts";
import { TurnstileCaptchaVerifier } from "./application/captcha/turnstileCaptchaVerifier.ts";
import { normalizeEmailIdentity } from "./domain/auth/emailAddress.ts";
import {
  BlockUserRoute,
  CreateReportRoute,
  ListBlockedUsersRoute,
  UnblockUserRoute,
} from "./application/http/routes/safety/safetyRoutes.ts";
import {
  ApplySanctionRoute,
  AssignReportRoute,
  GetReportContextRoute,
  GetReportRoute,
  ListAuditEventsRoute,
  ListReportsRoute,
  ListSanctionsRoute,
  RevokeSanctionRoute,
  TransitionReportRoute,
} from "./application/http/routes/moderation/moderationRoutes.ts";
import { PublicConfigRoute } from "./application/http/routes/config/publicConfigRoute.ts";
import { SqliteAdministrationRepository } from "./storage/repositories/sqliteAdministrationRepository.ts";
import { SettingsService } from "./domain/administration/settingsService.ts";
import { RuntimePolicy } from "./domain/administration/runtimePolicy.ts";
import { AdministrationService } from "./domain/administration/administrationService.ts";
import { AdministrationPermissionService } from "./domain/administration/permissionRegistry.ts";
import {
  AssignAdminRoleRoute,
  ControlCenterMeRoute,
  CreateAdminChannelRoute,
  ForceAdminPasswordResetRoute,
  GetAdminUserRoute,
  ListAdminChannelsRoute,
  ListAdminSettingsRoute,
  ListAdminUsersRoute,
  ResetAdminMediaRoute,
  RevokeAdminRoleRoute,
  RevokeAdminUserSessionsRoute,
  SetAdminChannelStateRoute,
  TransferOwnershipRoute,
  UpdateAdminChannelRoute,
  UpdateAdminSettingRoute,
  UpdateAdminUserRoute,
} from "./application/http/routes/administration/administrationRoutes.ts";

const config = loadConfig();
const logger = createLogger(config.logLevel, "main", {
  includeErrorStacks: config.appEnv !== "production",
});

const migrationsDir = new URL("../db/migrations", import.meta.url).pathname;
const db = await openDatabase(config.databasePath, migrationsDir, logger);
const codec = new JsonCodec();

const userRepository = new SqliteUserRepository(db);
const refreshTokenRepository = new SqliteUserSessionRepository(db);
const emailVerificationTokenRepository = new SqliteEmailVerificationTokenRepository(db);
const passwordResetTokenRepository = new SqlitePasswordResetTokenRepository(db);
const emailChangeTokenRepository = new SqliteEmailChangeTokenRepository(db);
const preferencesRepository = new SqlitePreferencesRepository(db);
const roomRepository = new SqliteConversationRepository(db);
const roomMemberRepository = new SqliteConversationMembershipRepository(db);
const directConversationPairRepository = new SqliteDirectConversationPairRepository(db);
const messageRepository = new SqliteMessageRepository(db);
const roomReadRepository = new SqliteConversationReadRepository(db);
const reactionRepository = new SqliteReactionRepository(db);
const attachmentRepository = new SqliteAttachmentRepository(db);
const notificationRepository = new SqliteNotificationRepository(db);
const safetyRepository = new SqliteSafetyRepository(db);
const administrationRepository = new SqliteAdministrationRepository(db);
const transactionManager = new SqliteTransactionManager(db);
const passwordHasher = new WebCryptoPasswordHasher();
const tokenService = new TokenService({
  secret: config.jwtSecret,
  accessTokenTtlSeconds: config.accessTokenTtlSeconds,
});
if (config.bootstrapOwnerEmail) {
  const promoted = administrationRepository.setRoleByEmailIfNoOwner(
    normalizeEmailIdentity(config.bootstrapOwnerEmail),
    "owner",
  );
  logger.info("owner bootstrap evaluated", { promoted });
}
const administrationPermissions = new AdministrationPermissionService(administrationRepository);
const settingsService = new SettingsService(administrationRepository, administrationPermissions, {
  upload: config.maxAttachmentSizeBytes,
  avatar: config.maxAvatarSizeBytes,
  cover: config.maxCoverSizeBytes,
});
const runtimePolicy = new RuntimePolicy(administrationRepository, settingsService);
const blockPolicy = new BlockPolicy(safetyRepository);
const sanctionPolicy = new SanctionPolicy(safetyRepository);
const captchaVerifier = config.captchaAdapter === "none"
  ? undefined
  : (config.captchaAdapter === "turnstile"
    ? new TurnstileCaptchaVerifier({
      secretKey: config.captchaSecretKey ?? "",
      expectedHostname: config.captchaExpectedHostname,
    })
    : new DevelopmentCaptchaVerifier());
const mailLogger = logger.child("mail");
const mailService = config.mailAdapter === "resend"
  ? new ResendMailService({
    apiKey: config.resendApiKey ?? "",
    fromAddress: config.mailFromAddress,
    fromName: config.mailFromName,
  })
  : new DevelopmentMailService(mailLogger);
const authService = new AuthService({
  users: userRepository,
  userSessions: refreshTokenRepository,
  emailVerificationTokens: emailVerificationTokenRepository,
  passwordResetTokens: passwordResetTokenRepository,
  emailChangeTokens: emailChangeTokenRepository,
  passwordHasher,
  tokenService,
  transactions: transactionManager,
  mailService,
  logger: logger.child("auth"),
  sessionDefaultTtlMs: config.sessionDefaultTtlMs,
  sessionRememberedTtlMs: config.sessionRememberedTtlMs,
  emailVerificationTtlMs: config.emailVerificationTtlMs,
  passwordResetTtlMs: config.passwordResetTtlMs,
  emailChangeTtlMs: config.emailChangeTtlMs,
  publicBaseUrl: config.publicBaseUrl,
});
const accountPolicy = new AccountPolicy(userRepository, settingsService);
const userService = new UserService(userRepository);
const presenceService = new PresenceService(userRepository);
const preferencesService = new PreferencesService(preferencesRepository);
const channelService = new ChannelService(roomRepository);
const groupService = new GroupService(
  roomRepository,
  roomMemberRepository,
  userRepository,
  preferencesRepository,
  () => settingsService.get<number>("max_group_members"),
);
const permissionService = new PermissionService(roomMemberRepository);
const dmService = new DmService(
  roomRepository,
  roomMemberRepository,
  directConversationPairRepository,
  userRepository,
  preferencesRepository,
  transactionManager,
  blockPolicy,
  sanctionPolicy,
  settingsService,
);
// Token-bucket per (userId, category) — architecture doc §5. Each write-heavy WS event
// gets its own bucket, tuned to how expensive/frequent that action is expected to be.
const authRegisterRateLimiter = new RateLimiter({ maxTokens: 5, refillIntervalMs: 300_000 });
const messageSendRateLimiter = new RateLimiter({ maxTokens: 10, refillIntervalMs: 10_000 });
const messageMutationRateLimiter = new RateLimiter({ maxTokens: 20, refillIntervalMs: 10_000 });
const reactionRateLimiter = new RateLimiter({ maxTokens: 30, refillIntervalMs: 10_000 });
const groupCreateRateLimiter = new RateLimiter({ maxTokens: 5, refillIntervalMs: 60_000 });
const groupMembershipRateLimiter = new RateLimiter({ maxTokens: 15, refillIntervalMs: 30_000 });
const dmOpenRateLimiter = new RateLimiter({ maxTokens: 10, refillIntervalMs: 10_000 });
const authLoginRateLimiter = new RateLimiter({ maxTokens: 10, refillIntervalMs: 60_000 });
const authRefreshRateLimiter = new RateLimiter({ maxTokens: 30, refillIntervalMs: 60_000 });
const authLogoutRateLimiter = new RateLimiter({ maxTokens: 30, refillIntervalMs: 60_000 });
const changePasswordRateLimiter = new RateLimiter({ maxTokens: 5, refillIntervalMs: 600_000 });
const sessionRevokeRateLimiter = new RateLimiter({ maxTokens: 20, refillIntervalMs: 60_000 });
const verifyEmailResendRateLimiter = new RateLimiter({ maxTokens: 5, refillIntervalMs: 600_000 });
const verifyEmailCompleteRateLimiter = new RateLimiter({
  maxTokens: 20,
  refillIntervalMs: 300_000,
});
const passwordResetRequestIpRateLimiter = new RateLimiter({
  maxTokens: 10,
  refillIntervalMs: 600_000,
});
const passwordResetRequestEmailRateLimiter = new RateLimiter({
  maxTokens: 5,
  refillIntervalMs: 600_000,
});
const passwordResetCompleteRateLimiter = new RateLimiter({
  maxTokens: 10,
  refillIntervalMs: 600_000,
});
const emailChangeStartRateLimiter = new RateLimiter({ maxTokens: 5, refillIntervalMs: 600_000 });
const emailChangeCompleteRateLimiter = new RateLimiter({
  maxTokens: 10,
  refillIntervalMs: 600_000,
});
const safetyActionRateLimiter = new RateLimiter({ maxTokens: 30, refillIntervalMs: 60_000 });
const reportCreateRateLimiter = new RateLimiter({ maxTokens: 5, refillIntervalMs: 600_000 });
const moderationRateLimiter = new RateLimiter({ maxTokens: 120, refillIntervalMs: 60_000 });
const administrationRateLimiter = new RateLimiter({ maxTokens: 120, refillIntervalMs: 60_000 });
const mediaUploadRateLimiter = new RateLimiter({ maxTokens: 20, refillIntervalMs: 60_000 });
const avatarUploadRateLimiter = new RateLimiter({ maxTokens: 5, refillIntervalMs: 600_000 });
const coverUploadRateLimiter = new RateLimiter({ maxTokens: 5, refillIntervalMs: 600_000 });
const wsInboundRateLimiter = new RateLimiter({
  maxTokens: config.wsInboundRateLimitMaxTokens,
  refillIntervalMs: config.wsInboundRateLimitRefillIntervalMs,
});
const messageService = new MessageService(
  messageRepository,
  roomRepository,
  permissionService,
  messageSendRateLimiter,
  transactionManager,
  reactionRepository,
  attachmentRepository,
  {
    requireMessage(userId, room) {
      sanctionPolicy.requireCanMessage(userId);
      runtimePolicy.requireMutation(userId);
      runtimePolicy.requireChannelMutation(room.id);
      if (room.type !== "dm") return;
      const other = roomMemberRepository.listMembers(room.id).find((member) =>
        member.userId !== userId
      );
      if (other) blockPolicy.requireDirectInteraction(userId, other.userId);
    },
    requireMutation(userId, room) {
      runtimePolicy.requireMutation(userId);
      runtimePolicy.requireChannelMutation(room.id);
    },
  },
);
const roomReadService = new ConversationReadService(
  roomReadRepository,
  roomRepository,
  permissionService,
);
const reactionService = new ReactionService(
  reactionRepository,
  messageRepository,
  roomRepository,
  permissionService,
);
const attachmentService = new AttachmentService(attachmentRepository);
const notificationService = new NotificationService(
  notificationRepository,
  userRepository,
  blockPolicy,
);
const searchService = new SearchService(
  messageRepository,
  messageService,
  roomRepository,
  permissionService,
  userRepository,
);

const connectionManager = new ConnectionManager({
  maxConnectionsPerUser: config.wsMaxConnectionsPerUser,
  maxConnectionsPerIp: config.wsMaxConnectionsPerIp,
  maxBufferedAmountBytes: config.wsMaxBufferedAmountBytes,
  logger: logger.child("connection-manager"),
  hooks: {
    onConnectionOpened: (connection, isFirstOpenConnectionForUser) => {
      const transition = presenceService.handleConnect(
        connection.userId,
        isFirstOpenConnectionForUser,
      );
      if (!transition) return;
      connectionManager.broadcastToAll(
        codec.encode(outboundPush("presence.updated", transition)),
      );
    },
    onConnectionClosed: (connection, details) => {
      if (!details.wasOpen) return;
      const transition = presenceService.handleDisconnect(
        connection.userId,
        details.isLastOpenConnectionForUser,
      );
      if (!transition) return;
      connectionManager.broadcastToAll(
        codec.encode(outboundPush("presence.updated", transition)),
      );
    },
  },
});
const safetyService = new SafetyService({
  safety: safetyRepository,
  users: userRepository,
  messages: messageRepository,
  attachments: attachmentRepository,
  conversations: roomRepository,
  permissions: permissionService,
  transactions: transactionManager,
  onAccountSuspended: (userId) =>
    connectionManager.closeUserConnections(userId, 1008, "Account policy changed."),
  administrationPermissions,
});
const administrationService = new AdministrationService({
  administration: administrationRepository,
  sessions: refreshTokenRepository,
  safety: safetyRepository,
  transactions: transactionManager,
  onRoleChanged: (userId) =>
    connectionManager.closeUserConnections(userId, 1008, "Account policy changed."),
  onMediaReset: async (mediaUrl) => {
    const id = /^\/media\/(.+)$/.exec(mediaUrl)?.[1];
    const attachment = id ? attachmentService.findById(id) : null;
    if (!attachment || (attachment.kind !== "avatar" && attachment.kind !== "cover")) return;
    attachmentService.delete(attachment.id);
    await deleteMediaFile(config.mediaRoot, attachment.storagePath);
  },
});
const typingService = new TypingService((transition) => {
  const room = roomRepository.findById(transition.conversationId);
  if (!room) return;
  pushToRoomAudience(
    room,
    codec.encode(outboundPush("typing.updated", transition)),
    connectionManager,
    roomMemberRepository,
  );
});

const wsRegistry = new WebSocketHandlerRegistry(sanctionPolicy, runtimePolicy);
wsRegistry.register(new SystemPongHandler());
wsRegistry.register(new UpdatePresenceHandler(presenceService, connectionManager, codec));
wsRegistry.register(new GetProfileHandler(userService, blockPolicy));
wsRegistry.register(new UpdateProfileHandler(userService));
wsRegistry.register(new GetPreferencesHandler(preferencesService));
wsRegistry.register(new UpdatePreferencesHandler(preferencesService));
wsRegistry.register(new ListChannelsHandler(channelService));
wsRegistry.register(new ListGroupsHandler(groupService));
wsRegistry.register(new GroupMembersHandler(groupService));
wsRegistry.register(
  new CreateGroupHandler(
    groupService,
    messageService,
    roomRepository,
    roomMemberRepository,
    notificationService,
    transactionManager,
    groupCreateRateLimiter,
    connectionManager,
    codec,
    accountPolicy,
    sanctionPolicy,
    blockPolicy,
    settingsService,
  ),
);
wsRegistry.register(
  new AddMemberHandler(
    groupService,
    messageService,
    roomRepository,
    roomMemberRepository,
    notificationService,
    transactionManager,
    groupMembershipRateLimiter,
    connectionManager,
    codec,
    accountPolicy,
    sanctionPolicy,
    blockPolicy,
  ),
);
wsRegistry.register(
  new RemoveMemberHandler(
    groupService,
    messageService,
    roomRepository,
    roomMemberRepository,
    transactionManager,
    groupMembershipRateLimiter,
    connectionManager,
    codec,
    accountPolicy,
    sanctionPolicy,
  ),
);
wsRegistry.register(
  new LeaveGroupHandler(
    groupService,
    messageService,
    roomRepository,
    roomMemberRepository,
    transactionManager,
    groupMembershipRateLimiter,
    connectionManager,
    codec,
  ),
);
wsRegistry.register(new OpenDmHandler(dmService, dmOpenRateLimiter, accountPolicy));
wsRegistry.register(new ListDmHandler(dmService));
wsRegistry.register(
  new SendMessageHandler(
    messageService,
    roomReadService,
    roomRepository,
    roomMemberRepository,
    notificationService,
    connectionManager,
    codec,
    accountPolicy,
    settingsService,
    runtimePolicy,
  ),
);
wsRegistry.register(
  new EditMessageHandler(
    messageService,
    roomRepository,
    roomMemberRepository,
    messageMutationRateLimiter,
    connectionManager,
    codec,
    sanctionPolicy,
    () => settingsService.get<number>("max_message_length"),
  ),
);
wsRegistry.register(
  new DeleteMessageHandler(
    messageService,
    roomRepository,
    roomMemberRepository,
    messageMutationRateLimiter,
    connectionManager,
    codec,
  ),
);
wsRegistry.register(new MessageHistoryHandler(messageService));
wsRegistry.register(new MarkReadHandler(roomReadService, connectionManager, codec));
wsRegistry.register(
  new ToggleReactionHandler(
    reactionService,
    roomRepository,
    roomMemberRepository,
    notificationService,
    reactionRateLimiter,
    connectionManager,
    codec,
    accountPolicy,
    sanctionPolicy,
    runtimePolicy,
  ),
);
wsRegistry.register(
  new TypingStartHandler(
    typingService,
    roomRepository,
    roomMemberRepository,
    permissionService,
    connectionManager,
    codec,
  ),
);
wsRegistry.register(
  new TypingStopHandler(
    typingService,
    roomRepository,
    roomMemberRepository,
    permissionService,
    connectionManager,
    codec,
  ),
);
wsRegistry.register(new ListNotificationsHandler(notificationService));
wsRegistry.register(new MarkNotificationReadHandler(notificationService));
wsRegistry.register(new SearchMessagesHandler(searchService));
wsRegistry.register(
  new SearchUsersHandler(searchService, accountPolicy, blockPolicy, sanctionPolicy),
);

const registry = new RouteRegistry();
registry.register(new HealthLiveRoute(codec));
registry.register(new HealthReadyRoute("/health/ready", db, codec, logger.child("health-ready")));
registry.register(new HealthReadyRoute("/health", db, codec, logger.child("health-ready")));
registry.register(
  new RegisterRoute(
    authService,
    codec,
    authRegisterRateLimiter,
    captchaVerifier,
    safetyService,
    runtimePolicy,
  ),
);
registry.register(
  new LoginRoute(
    authService,
    authLoginRateLimiter,
    codec,
    captchaVerifier,
    safetyService,
  ),
);
registry.register(new RefreshRoute(authService, codec, authRefreshRateLimiter));
registry.register(new LogoutRoute(authService, tokenService, codec, authLogoutRateLimiter));
registry.register(
  new ChangePasswordRoute(authService, tokenService, codec, changePasswordRateLimiter),
);
registry.register(new AccountRoute(authService, tokenService, codec));
registry.register(new ListSessionsRoute(authService, tokenService, codec));
registry.register(
  new RevokeOtherSessionsRoute(
    authService,
    tokenService,
    codec,
    sessionRevokeRateLimiter,
  ),
);
registry.register(
  new RevokeSessionRoute(authService, tokenService, codec, sessionRevokeRateLimiter),
);
registry.register(
  new ResendVerificationRoute(
    authService,
    tokenService,
    codec,
    verifyEmailResendRateLimiter,
  ),
);
registry.register(
  new CompleteEmailVerificationRoute(authService, codec, verifyEmailCompleteRateLimiter),
);
registry.register(
  new PasswordResetRequestRoute(
    authService,
    codec,
    passwordResetRequestIpRateLimiter,
    passwordResetRequestEmailRateLimiter,
    captchaVerifier,
    safetyService,
  ),
);
registry.register(
  new PasswordResetCompleteRoute(authService, codec, passwordResetCompleteRateLimiter),
);
registry.register(
  new StartEmailChangeRoute(authService, tokenService, codec, emailChangeStartRateLimiter),
);
registry.register(
  new CompleteEmailChangeRoute(
    authService,
    tokenService,
    codec,
    emailChangeCompleteRateLimiter,
  ),
);
registry.register(
  new UploadRoute(
    tokenService,
    attachmentService,
    config.mediaRoot,
    config.maxAttachmentSizeBytes,
    codec,
    mediaUploadRateLimiter,
    accountPolicy,
    sanctionPolicy,
    settingsService,
    runtimePolicy,
  ),
);
registry.register(
  new PublicConfigRoute(codec, config.captchaAdapter, config.captchaSiteKey),
);
registry.register(
  new ListBlockedUsersRoute(
    safetyService,
    tokenService,
    codec,
    safetyActionRateLimiter,
    runtimePolicy,
  ),
);
registry.register(
  new BlockUserRoute(safetyService, tokenService, codec, safetyActionRateLimiter, runtimePolicy),
);
registry.register(
  new UnblockUserRoute(safetyService, tokenService, codec, safetyActionRateLimiter, runtimePolicy),
);
registry.register(
  new CreateReportRoute(safetyService, tokenService, codec, reportCreateRateLimiter, runtimePolicy),
);
registry.register(
  new ListReportsRoute(safetyService, tokenService, codec, moderationRateLimiter),
);
registry.register(
  new GetReportContextRoute(safetyService, tokenService, codec, moderationRateLimiter),
);
registry.register(
  new GetReportRoute(safetyService, tokenService, codec, moderationRateLimiter),
);
registry.register(
  new AssignReportRoute(safetyService, tokenService, codec, moderationRateLimiter),
);
registry.register(
  new TransitionReportRoute(safetyService, tokenService, codec, moderationRateLimiter),
);
registry.register(
  new ListSanctionsRoute(safetyService, tokenService, codec, moderationRateLimiter),
);
registry.register(
  new ApplySanctionRoute(safetyService, tokenService, codec, moderationRateLimiter),
);
registry.register(
  new RevokeSanctionRoute(safetyService, tokenService, codec, moderationRateLimiter),
);
registry.register(
  new ListAuditEventsRoute(safetyService, tokenService, codec, moderationRateLimiter),
);
registry.register(
  new ControlCenterMeRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new ListAdminUsersRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new GetAdminUserRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new UpdateAdminUserRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new RevokeAdminUserSessionsRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new ForceAdminPasswordResetRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new ResetAdminMediaRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    "avatar",
    administrationRateLimiter,
  ),
);
registry.register(
  new ResetAdminMediaRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    "cover",
    administrationRateLimiter,
  ),
);
registry.register(
  new AssignAdminRoleRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new RevokeAdminRoleRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new TransferOwnershipRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new ListAdminChannelsRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new CreateAdminChannelRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new UpdateAdminChannelRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    administrationRateLimiter,
  ),
);
registry.register(
  new SetAdminChannelStateRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    "archived",
    administrationRateLimiter,
  ),
);
registry.register(
  new SetAdminChannelStateRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    "active",
    administrationRateLimiter,
  ),
);
registry.register(
  new ListAdminSettingsRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    settingsService,
    administrationRateLimiter,
  ),
);
registry.register(
  new UpdateAdminSettingRoute(
    administrationService,
    tokenService,
    codec,
    runtimePolicy,
    settingsService,
    administrationRateLimiter,
  ),
);
registry.register(
  new AvatarRoute(
    tokenService,
    attachmentService,
    userService,
    config.mediaRoot,
    config.maxAvatarSizeBytes,
    codec,
    avatarUploadRateLimiter,
    accountPolicy,
    sanctionPolicy,
    settingsService,
    runtimePolicy,
  ),
);
registry.register(
  new CoverRoute(
    tokenService,
    attachmentService,
    userService,
    config.mediaRoot,
    config.maxCoverSizeBytes,
    codec,
    coverUploadRateLimiter,
    accountPolicy,
    sanctionPolicy,
    settingsService,
    runtimePolicy,
  ),
);
registry.register(
  new ServeMediaRoute(
    attachmentService,
    messageRepository,
    roomRepository,
    permissionService,
    tokenService,
    config.mediaRoot,
    codec,
  ),
);

const sessionCleanupJob = new SessionCleanupJob(
  authService,
  logger.child("session-cleanup"),
  {
    intervalMs: config.sessionCleanupIntervalMs,
    revokedSessionRetentionMs: config.revokedSessionRetentionMs,
  },
);
sessionCleanupJob.runOnce();
sessionCleanupJob.start();

const webSocketLifecycleJob = new WebSocketLifecycleJob(
  connectionManager,
  codec,
  logger.child("ws-lifecycle"),
  {
    heartbeatIntervalMs: config.wsHeartbeatIntervalMs,
    idleTimeoutMs: config.wsIdleTimeoutMs,
  },
);
webSocketLifecycleJob.start();

// Serve the static frontend assets from the web/ directory.
const webDir = new URL("../web", import.meta.url).pathname;
const controlCenterDir = new URL("../web/control-center", import.meta.url).pathname;
registry.register(new ControlCenterStaticRoute("/control-center", controlCenterDir, codec));
registry.register(new ControlCenterStaticRoute("/control-center/*", controlCenterDir, codec));
registry.register(new StaticRoute("*", webDir, codec));

// Orphan-cleanup: uploads never attached to a message are garbage collected after an
// hour (docs/04-http-api.md "Media Upload"). A reference-implementation `setInterval` is
// enough here; a production deployment would want this durable/cron-based instead of
// tied to this process's lifetime.
const ORPHAN_MAX_AGE_MS = 60 * 60 * 1000;
const orphanCleanupTimer = setInterval(() => {
  const expired = attachmentService.sweepExpiredOrphans(ORPHAN_MAX_AGE_MS);
  for (const attachment of expired) {
    deleteMediaFile(config.mediaRoot, attachment.storagePath).catch((error) => {
      logger.error("failed to delete orphaned attachment file", {
        id: attachment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}, ORPHAN_MAX_AGE_MS);

const server = startHttpServer({
  host: config.host,
  port: config.port,
  registry,
  codec,
  logger,
  allowedOrigins: config.allowedOrigins,
  enableHsts: config.appEnv === "production" && config.publicHttps,
  wsUpgrade: (request, clientIp) =>
    handleWsUpgrade(request, {
      clientIp,
      registry: wsRegistry,
      connectionManager,
      codec,
      logger,
      tokenService,
      allowedOrigins: config.allowedOrigins,
      maxMessageBytes: config.maxWsMessageBytes,
      protocolErrorLimit: config.wsProtocolErrorLimit,
      inboundRateLimiter: wsInboundRateLimiter,
      sanctionPolicy,
      runtimePolicy,
    }),
});
logger.info("server started", {
  host: config.host,
  port: config.port,
  appEnv: config.appEnv,
  allowedOrigins: config.allowedOrigins,
  publicBaseUrl: config.publicBaseUrl,
  maxWsMessageBytes: config.maxWsMessageBytes,
  wsMaxConnectionsPerUser: config.wsMaxConnectionsPerUser,
  wsMaxConnectionsPerIp: config.wsMaxConnectionsPerIp,
  wsMaxBufferedAmountBytes: config.wsMaxBufferedAmountBytes,
  wsHeartbeatIntervalMs: config.wsHeartbeatIntervalMs,
  wsIdleTimeoutMs: config.wsIdleTimeoutMs,
  publicHttps: config.publicHttps,
});

let dbClosed = false;
function closeDatabase(): void {
  if (dbClosed) return;
  db.close();
  dbClosed = true;
}

let shutdownPromise: Promise<void> | null = null;

async function shutdown(): Promise<void> {
  if (shutdownPromise) return await shutdownPromise;
  shutdownPromise = (async () => {
    const serverShutdown = server.shutdown();
    webSocketLifecycleJob.stop();
    connectionManager.shutdownAllConnections();
    sessionCleanupJob.stop();
    clearInterval(orphanCleanupTimer);
    await serverShutdown;
    closeDatabase();
  })();
  return await shutdownPromise;
}

Deno.addSignalListener("SIGINT", () => {
  void shutdown();
});
Deno.addSignalListener("SIGTERM", () => {
  void shutdown();
});

try {
  await server.finished;
} finally {
  webSocketLifecycleJob.stop();
  connectionManager.shutdownAllConnections();
  sessionCleanupJob.stop();
  clearInterval(orphanCleanupTimer);
  closeDatabase();
}
