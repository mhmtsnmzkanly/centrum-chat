# CentrumChat Server — Folder Structure

```
centrum-chat/
├── deno.json                        # tasks, compiler options, lint/fmt config
├── deno.lock
├── .env.example
├── README.md
├── docs/                            # this design doc set
├── db/
│   └── migrations/
│       ├── 0001_init.sql
│       ├── 0002_seed_channels.sql
│       ├── 0003_attachment_kind.sql # adds attachments.kind ('attachment'|'avatar')
│       ├── 0004_conversation_terminology.sql
│       ├── 0005_direct_conversation_pairs.sql
│       ├── 0006_attachment_ownership_and_security_foundation.sql
│       └── 0007_account_security_and_recovery.sql
├── storage/                         # MEDIA_ROOT + DATABASE_PATH root (git-ignored): database/, profile/, cover/, attachments/
├── web/                             # static web assets (index.html, index.css, index.js)
├── src/
│   ├── main.ts                      # composition root: wires config→db→repos→services→handlers→transport, then listens
│   │
│   ├── transport/
│   │   ├── http/
│   │   │   ├── httpServer.ts        # Deno.serve wrapper, access logging, security headers, CORS/origin policy, routes to RouteRegistry or WS upgrade
│   │   │   └── wsUpgrade.ts         # validates token + Origin policy, enforces WS connection admission, performs the upgrade
│   │   └── websocket/
│   │       ├── connectionManager.ts # authoritative connection registry, counters, send boundary, backpressure, and close orchestration
│   │       └── connection.ts        # per-socket read loop: decode → dispatch → encode, with inbound size/rate/protocol-abuse guards
│   │
│   ├── protocol/
│   │   ├── protocolCodec.ts         # ProtocolCodec interface
│   │   ├── jsonCodec.ts             # JsonCodec implements ProtocolCodec (only file allowed JSON.parse/stringify)
│   │   └── envelopes.ts             # InboundEnvelope / OutboundResponse / OutboundPush / ErrorPayload types
│   │
│   ├── application/
│   │   ├── mail/{developmentMailService,resendMailService}.ts
│   │   ├── lifecycle/sessionCleanupJob.ts   # interval-backed user-session cleanup job started/stopped by main.ts
│   │   ├── lifecycle/webSocketLifecycleJob.ts # shared heartbeat + stale-connection sweep job
│   │   ├── websocket/
│   │   │   ├── eventHandler.ts      # EventHandler interface
│   │   │   ├── registry.ts          # event:string -> handler map + dispatch(); main.ts populates it
│   │   │   ├── handlers/system/systemPongHandler.ts
│   │   │   ├── conversationFanout.ts # roomAudienceUserIds/pushToRoomAudience — shared channel-vs-group/dm fan-out logic
│   │   │   ├── rateLimitGuard.ts    # requireRateLimit() — the RATE_LIMITED guard every limited WS handler calls first
│   │   │   └── handlers/
│   │   │       ├── presence/updatePresenceHandler.ts
│   │   │       ├── channels/listChannelsHandler.ts   # channels are public — no join/leave handler
│   │   │       ├── groups/{listGroupsHandler,createGroupHandler,addMemberHandler,removeMemberHandler,leaveGroupHandler,groupBroadcast,groupMembersHandler}.ts
│   │   │       ├── dm/{openDmHandler,listDmHandler}.ts
│   │   │       ├── messages/{sendMessageHandler,editMessageHandler,deleteMessageHandler,messageHistoryHandler,markReadHandler}.ts
│   │   │       ├── reactions/toggleReactionHandler.ts
│   │   │       ├── typing/{typingStartHandler,typingStopHandler}.ts
│   │   │       ├── notifications/{listNotificationsHandler,markNotificationReadHandler}.ts
│   │   │       ├── search/{searchMessagesHandler,searchUsersHandler}.ts
│   │   │       └── profile/{getProfileHandler,updateProfileHandler,getPreferencesHandler,updatePreferencesHandler}.ts
│   │   ├── http/
│   │   │   ├── routeHandler.ts      # RouteHandler interface (HttpRequestContext carries clientIp for IP-scoped rate limiting)
│   │   │   ├── routeRegistry.ts
│   │   │   ├── cors.ts              # preflight handling + configured Access-Control-Allow-* policy
│   │   │   ├── rateLimitGuard.ts    # requireHttpRateLimit() helper for IP/user-scoped HTTP limits
│   │   │   ├── responses.ts         # successResponse/errorResponse + decodeJsonBody (malformed body -> VALIDATION_ERROR)
│   │   │   └── routes/
│   │   │       ├── auth/{registerRoute,loginRoute,refreshRoute,logoutRoute,changePasswordRoute,accountRoute,listSessionsRoute,revokeSessionRoute,revokeOtherSessionsRoute,resendVerificationRoute,completeEmailVerificationRoute,passwordResetRequestRoute,passwordResetCompleteRoute,startEmailChangeRoute,completeEmailChangeRoute}.ts
│   │   │       ├── media/{uploadRoute,avatarRoute,serveMediaRoute,multipart,mediaStorage,coverRoute,uploadValidation}.ts
│   │   │       ├── health/{healthLiveRoute,healthReadyRoute}.ts
│   │   │       └── staticRoute.ts
│   │   └── middleware/
│   │       ├── authMiddleware.ts    # extractBearerToken/verifyAccessToken -> userId, shared by HTTP + WS upgrade
│   │       └── errorBoundary.ts     # catches domain errors -> ErrorPayload (§7 of architecture doc)
│   │
│   ├── domain/
│   │   ├── users/{user.entity.ts,userService.ts,userRepository.port.ts}
│   │   ├── auth/{authService.ts,passwordHasher.port.ts,webCryptoPasswordHasher.ts,tokenService.ts,userSessionRepository.port.ts,mailService.port.ts,emailVerificationTokenRepository.port.ts,passwordResetTokenRepository.port.ts,emailChangeTokenRepository.port.ts,accountPolicy.ts,emailVerificationRequiredError.ts,emailAddress.ts,accountSecurity.entity.ts}
│   │   ├── presence/presenceService.ts
│   │   ├── conversations/{conversation.entity.ts,channelService.ts,groupService.ts,dmService.ts,groupSystemMessages.ts,privacyPolicy.ts,directConversationPair.ts,conversationRepository.port.ts,conversationMembershipRepository.port.ts,directConversationPairRepository.port.ts}
│   │   ├── messages/{message.entity.ts,messageService.ts,messageRepository.port.ts,conversationReadService.ts,conversationReadRepository.port.ts}
│   │   ├── reactions/{reactionService.ts,reactionRepository.port.ts}
│   │   ├── typing/typingService.ts  # in-memory expiry timers, no DB
│   │   ├── notifications/{notification.entity.ts,notificationService.ts,notificationRepository.port.ts}
│   │   ├── search/searchService.ts  # reuses MessageService.toSummaries() for message.entity wire-shape assembly
│   │   ├── attachments/{attachment.entity.ts,attachmentService.ts,attachmentRepository.port.ts}
│   │   ├── preferences/{preferences.entity.ts,preferencesService.ts,preferencesRepository.port.ts}
│   │   └── permissions/permissionService.ts   # branches on room.type: open for channels, conversation_memberships-gated for group/dm (§13)
│   │
│   ├── storage/
│   │   ├── db.ts                    # opens SQLite, PRAGMAs, migration runner, withTransaction() helper
│   │   ├── sqlLike.ts                # escapeLikePattern() — used by the two repositories with a LIKE-based search()
│   │   └── repositories/
│   │       ├── sqliteUserRepository.ts
│   │       ├── sqliteUserSessionRepository.ts
│   │       ├── sqliteEmailVerificationTokenRepository.ts
│   │       ├── sqlitePasswordResetTokenRepository.ts
│   │       ├── sqliteEmailChangeTokenRepository.ts
│   │       ├── sqliteConversationRepository.ts
│   │       ├── sqliteConversationMembershipRepository.ts
│   │       ├── sqliteDirectConversationPairRepository.ts
│   │       ├── sqliteConversationReadRepository.ts   # conversation_reads — decoupled from membership, see architecture doc §13
│   │       ├── sqliteMessageRepository.ts
│   │       ├── sqliteReactionRepository.ts
│   │       ├── sqliteAttachmentRepository.ts
│   │       ├── sqliteNotificationRepository.ts
│   │       └── sqlitePreferencesRepository.ts
│   │
│   └── shared/
│       ├── config/config.ts
│       ├── logging/logger.ts
│       ├── crypto/encoding.ts        # base64Url encode/decode + toHex, used by tokenService's hand-rolled JWT
│       ├── errors/{domainError.ts,errorPayload.ts,notFoundError.ts,conflictError.ts,forbiddenError.ts,validationError.ts,unauthorizedError.ts,rateLimitedError.ts}
│       ├── validation/validator.ts  # tiny schema-validation helper, no external dep
│       ├── rateLimit/rateLimiter.ts # one instance per rate-limited category, keyed by ${event}:${userId} (or :${clientIp} pre-auth)
│       ├── security/{originPolicy.ts,securityHeaders.ts}
│       └── id.ts                    # crypto.randomUUID() wrapper
│
└── tests/
    ├── unit/                        # domain services (+ a few transport/shared primitives) against fakes, no I/O
    ├── integration/                 # full server boot + real WS client against a temp SQLite file
    ├── protocol/                    # JsonCodec encode/decode roundtrip + malformed-input handling
    ├── repository/                  # each Sqlite*Repository against a temp SQLite file
    └── support/                     # fakes (Fake*Repository) + WsMessageQueue test client + temp-db helper
```

Guiding rules: no file grows past ~500 lines (each WS event/HTTP route is already its own file,
so this is naturally satisfied); no SQL string outside `src/storage/**`; no
`JSON.parse`/`JSON.stringify` outside `src/protocol/jsonCodec.ts` (plus the two documented,
narrow exemptions: `shared/logging/logger.ts`'s log-line formatting and
`domain/auth/tokenService.ts`'s JWT internals — neither touches the client-facing wire
protocol); `src/domain/**` never imports from `src/transport/**`, `src/protocol/**`, or
`src/storage/**` (only repository *port* interfaces, which live alongside their domain module,
e.g. `userRepository.port.ts`).
- `domain/safety/`: block, report, sanction, audit, authorization policy, and service contracts.
- `application/captcha/`: development and Turnstile implementations of the CAPTCHA port.
- `application/http/routes/safety/`: normal-user safety routes.
- `application/http/routes/moderation/`: persisted-role operator routes.
- `domain/administration/`: permission registry, settings, and administration services.
- `application/http/routes/administration/`: Control Center HTTP contract.
- `storage/repositories/sqliteAdministrationRepository.ts`: administration SQL.

`web/control-center.html` and the flat `web/scripts/control-center*.js` modules contain the
integrated, API-backed Control Center client. `web/auth.html` and `web/scripts/shared-auth.js`
provide the shared authentication boundary for it and the main chat. Public `web/` contains no
fixtures or frontend tests. This checkout has no `web/admin/` tree, and `/admin` remains unchanged
(not found).
