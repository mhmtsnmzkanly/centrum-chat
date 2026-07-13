import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import type { AdministrationService } from "../../../../domain/administration/administrationService.ts";
import type { SettingsService } from "../../../../domain/administration/settingsService.ts";
import type { RuntimePolicy } from "../../../../domain/administration/runtimePolicy.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";
import {
  asRecord,
  optionalBoolean,
  optionalInteger,
  optionalString,
  requireEnum,
  requireString,
} from "../../../../shared/validation/validator.ts";
import { SYSTEM_ROLES } from "../../../../domain/administration/administration.entity.ts";
import { ValidationError } from "../../../../shared/errors/validationError.ts";

function page(request: Request): { cursor: string | null; limit: number; url: URL } {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && (cursor.length === 0 || cursor.length > 100)) {
    throw new ValidationError("cursor must be between 1 and 100 characters.");
  }
  const limit = Number(url.searchParams.get("limit") ?? 25);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError("limit must be an integer between 1 and 100.");
  }
  return { cursor, limit, url };
}
function queryBoolean(url: URL, key: string): boolean | undefined {
  const value = url.searchParams.get(key);
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ValidationError(key + " must be true or false.");
}
function exactKeys(body: Record<string, unknown>, allowed: readonly string[]): void {
  const invalid = Object.keys(body).find((key) => !allowed.includes(key));
  if (invalid) throw new ValidationError("Unsupported field: " + invalid);
}

abstract class AdministrationRoute {
  constructor(
    protected readonly administration: AdministrationService,
    protected readonly tokenService: TokenService,
    protected readonly codec: ProtocolCodec,
    protected readonly runtime: RuntimePolicy,
    protected readonly rateLimiter?: RateLimiter,
  ) {}
  protected async auth(ctx: HttpRequestContext, operation: string) {
    const auth = await verifyAccessToken(
      this.tokenService,
      extractBearerToken(ctx.request.headers.get("authorization")),
    );
    this.runtime.requireAccountAccess(auth.userId);
    if (this.rateLimiter) {
      requireHttpRateLimit(
        this.rateLimiter,
        `administration.${operation}:${auth.userId}`,
        "Too many administration operations. Try again later.",
      );
    }
    return auth;
  }
}

export class ControlCenterMeRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/control-center/me";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "me");
    return successResponse(this.codec, this.administration.operator(auth.userId), 200);
  }
}
export class ListAdminUsersRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/admin/users";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "users.list");
    const input = page(ctx.request);
    const roleRaw = input.url.searchParams.get("role");
    if (roleRaw !== null && !SYSTEM_ROLES.includes(roleRaw as never)) {
      throw new ValidationError("role is invalid.");
    }
    const search = input.url.searchParams.get("search")?.trim();
    if (search && search.length > 100) throw new ValidationError("search is too long.");
    return successResponse(
      this.codec,
      this.administration.listUsers(
        auth.userId,
        {
          ...(search ? { search } : {}),
          ...(roleRaw ? { role: roleRaw as typeof SYSTEM_ROLES[number] } : {}),
          ...(queryBoolean(input.url, "verified") === undefined
            ? {}
            : { verified: queryBoolean(input.url, "verified")! }),
          ...(queryBoolean(input.url, "suspended") === undefined
            ? {}
            : { suspended: queryBoolean(input.url, "suspended")! }),
          ...(queryBoolean(input.url, "disabled") === undefined
            ? {}
            : { disabled: queryBoolean(input.url, "disabled")! }),
        },
        input.cursor,
        input.limit,
      ),
      200,
    );
  }
}
export class GetAdminUserRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/admin/users/:userId";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "users.get");
    return successResponse(this.codec, {
      user: this.administration.getUser(auth.userId, requireString(ctx.params, "userId")),
    }, 200);
  }
}
export class UpdateAdminUserRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "PATCH" as const;
  readonly path = "/api/admin/users/:userId";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "users.update");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    exactKeys(body, ["expectedVersion", "displayName", "bio", "disabled"]);
    const expectedVersion = optionalInteger(body, "expectedVersion", { min: 1 });
    if (expectedVersion === undefined) throw new ValidationError("expectedVersion is required.");
    return successResponse(this.codec, {
      user: this.administration.updateUser(
        auth.userId,
        requireString(ctx.params, "userId"),
        expectedVersion,
        {
          ...(body.displayName === undefined ? {} : {
            displayName: requireString(body, "displayName", { minLength: 1, maxLength: 50 }),
          }),
          ...(body.bio === undefined ? {} : {
            bio: requireString(body, "bio", { maxLength: 500 }),
          }),
          ...(body.disabled === undefined ? {} : {
            disabled: optionalBoolean(body, "disabled")!,
          }),
        },
      ),
    }, 200);
  }
}

abstract class UserCommandRoute extends AdministrationRoute {
  protected async command(ctx: HttpRequestContext, operation: string): Promise<{
    actorId: string;
    userId: string;
  }> {
    const auth = await this.auth(ctx, operation);
    return { actorId: auth.userId, userId: requireString(ctx.params, "userId") };
  }
}
export class RevokeAdminUserSessionsRoute extends UserCommandRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/admin/users/:userId/revoke-sessions";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const ids = await this.command(ctx, "users.revoke-sessions");
    return successResponse(this.codec, {
      revokedSessions: this.administration.revokeSessions(ids.actorId, ids.userId),
    }, 200);
  }
}
export class ForceAdminPasswordResetRoute extends UserCommandRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/admin/users/:userId/force-password-reset";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const ids = await this.command(ctx, "users.force-password-reset");
    this.administration.forcePasswordReset(ids.actorId, ids.userId);
    return successResponse(this.codec, { forced: true }, 200);
  }
}
export class ResetAdminMediaRoute extends UserCommandRoute implements RouteHandler {
  readonly method = "POST" as const;
  constructor(
    administration: AdministrationService,
    tokenService: TokenService,
    codec: ProtocolCodec,
    runtime: RuntimePolicy,
    private readonly kind: "avatar" | "cover",
    rateLimiter?: RateLimiter,
  ) {
    super(administration, tokenService, codec, runtime, rateLimiter);
  }
  get path(): string {
    return `/api/admin/users/:userId/reset-${this.kind}`;
  }
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const ids = await this.command(ctx, "users.reset-" + this.kind);
    await this.administration.resetMedia(ids.actorId, ids.userId, this.kind);
    return successResponse(this.codec, { reset: true }, 200);
  }
}
export class AssignAdminRoleRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/admin/users/:userId/roles";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "roles.assign");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    exactKeys(body, ["expectedRole", "role"]);
    this.administration.setRole(
      auth.userId,
      requireString(ctx.params, "userId"),
      requireEnum(body, "expectedRole", SYSTEM_ROLES),
      requireEnum(body, "role", SYSTEM_ROLES),
    );
    return successResponse(this.codec, { changed: true }, 200);
  }
}
export class RevokeAdminRoleRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "DELETE" as const;
  readonly path = "/api/admin/users/:userId/roles/:role";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "roles.revoke");
    const role = requireEnum(ctx.params, "role", SYSTEM_ROLES);
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    exactKeys(body, ["expectedRole"]);
    const expected = requireEnum(body, "expectedRole", SYSTEM_ROLES);
    if (role !== expected) throw new ValidationError("Route role must match expectedRole.");
    this.administration.setRole(
      auth.userId,
      requireString(ctx.params, "userId"),
      expected,
      "user",
    );
    return successResponse(this.codec, { changed: true }, 200);
  }
}
export class TransferOwnershipRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/owner/transfer";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "ownership.transfer");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    exactKeys(body, ["targetUserId", "expectedCurrentOwnerRole", "expectedTargetRole"]);
    this.administration.transferOwnership(
      auth.userId,
      requireString(body, "targetUserId"),
      requireEnum(body, "expectedCurrentOwnerRole", SYSTEM_ROLES),
      requireEnum(body, "expectedTargetRole", SYSTEM_ROLES),
    );
    return successResponse(this.codec, { transferred: true }, 200);
  }
}

export class ListAdminChannelsRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/admin/channels";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "channels.list");
    const input = page(ctx.request);
    const state = input.url.searchParams.get("state");
    if (state !== null && state !== "active" && state !== "archived") {
      throw new ValidationError("state is invalid.");
    }
    return successResponse(
      this.codec,
      this.administration.listChannels(
        auth.userId,
        state,
        input.cursor,
        input.limit,
      ),
      200,
    );
  }
}
export class CreateAdminChannelRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/admin/channels";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "channels.create");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    exactKeys(body, ["slug", "name", "description", "sortOrder"]);
    return successResponse(this.codec, {
      channel: this.administration.createChannel(auth.userId, {
        slug: requireString(body, "slug", { pattern: /^[a-z0-9-]{2,50}$/ }),
        name: requireString(body, "name", { minLength: 1, maxLength: 100 }),
        description: optionalString(body, "description", { maxLength: 500 }) ?? "",
        sortOrder: optionalInteger(body, "sortOrder", { min: 0, max: 10000 }) ?? 0,
      }),
    }, 201);
  }
}
export class UpdateAdminChannelRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "PATCH" as const;
  readonly path = "/api/admin/channels/:channelId";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "channels.update");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    exactKeys(body, ["expectedVersion", "name", "description", "sortOrder"]);
    const expected = optionalInteger(body, "expectedVersion", { min: 1 });
    if (expected === undefined) throw new ValidationError("expectedVersion is required.");
    return successResponse(this.codec, {
      channel: this.administration.updateChannel(
        auth.userId,
        requireString(ctx.params, "channelId"),
        expected,
        {
          ...(body.name === undefined ? {} : {
            name: requireString(body, "name", { minLength: 1, maxLength: 100 }),
          }),
          ...(body.description === undefined ? {} : {
            description: requireString(body, "description", { maxLength: 500 }),
          }),
          ...(body.sortOrder === undefined ? {} : {
            sortOrder: optionalInteger(body, "sortOrder", { min: 0, max: 10000 })!,
          }),
        },
      ),
    }, 200);
  }
}
export class SetAdminChannelStateRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "POST" as const;
  constructor(
    administration: AdministrationService,
    tokenService: TokenService,
    codec: ProtocolCodec,
    runtime: RuntimePolicy,
    private readonly state: "active" | "archived",
    rateLimiter?: RateLimiter,
  ) {
    super(administration, tokenService, codec, runtime, rateLimiter);
  }
  get path(): string {
    return `/api/admin/channels/:channelId/${this.state === "archived" ? "archive" : "restore"}`;
  }
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "channels." + this.state);
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    exactKeys(body, ["expectedVersion"]);
    const expected = optionalInteger(body, "expectedVersion", { min: 1 });
    if (expected === undefined) throw new ValidationError("expectedVersion is required.");
    return successResponse(this.codec, {
      channel: this.administration.setChannelState(
        auth.userId,
        requireString(ctx.params, "channelId"),
        expected,
        this.state,
      ),
    }, 200);
  }
}

export class ListAdminSettingsRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/admin/settings";
  constructor(
    administration: AdministrationService,
    tokenService: TokenService,
    codec: ProtocolCodec,
    runtime: RuntimePolicy,
    private readonly settings: SettingsService,
    rateLimiter?: RateLimiter,
  ) {
    super(administration, tokenService, codec, runtime, rateLimiter);
  }
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "settings.list");
    return successResponse(this.codec, { settings: this.settings.list(auth.userId) }, 200);
  }
}
export class UpdateAdminSettingRoute extends AdministrationRoute implements RouteHandler {
  readonly method = "PATCH" as const;
  readonly path = "/api/admin/settings";
  constructor(
    administration: AdministrationService,
    tokenService: TokenService,
    codec: ProtocolCodec,
    runtime: RuntimePolicy,
    private readonly settings: SettingsService,
    rateLimiter?: RateLimiter,
  ) {
    super(administration, tokenService, codec, runtime, rateLimiter);
  }
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "settings.update");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    exactKeys(body, ["key", "expectedVersion", "value"]);
    const expected = optionalInteger(body, "expectedVersion", { min: 1 });
    if (expected === undefined || !("value" in body)) {
      throw new ValidationError("expectedVersion and value are required.");
    }
    const updated = this.administration.updateSetting(
      auth.userId,
      this.settings,
      requireString(body, "key", { maxLength: 100 }),
      expected,
      body.value,
    );
    return successResponse(this.codec, { setting: updated }, 200);
  }
}
