import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { decodeJsonBody, successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { SafetyService } from "../../../../domain/safety/safetyService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";
import {
  asRecord,
  optionalString,
  requireEnum,
  requireString,
} from "../../../../shared/validation/validator.ts";
import { REPORT_STATUSES, SANCTION_TYPES } from "../../../../domain/safety/safety.entity.ts";
import { ValidationError } from "../../../../shared/errors/validationError.ts";

function page(request: Request): { cursor: string | null; limit: number; url: URL } {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const raw = url.searchParams.get("limit");
  const limit = raw === null ? 25 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError("limit must be an integer between 1 and 100.");
  }
  return { cursor, limit, url };
}
function optionalEnumParam<T extends string>(
  url: URL,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  if (!allowed.includes(value as T)) throw new ValidationError(name + " has an invalid value.");
  return value as T;
}
abstract class ModerationRoute {
  constructor(
    protected readonly safety: SafetyService,
    protected readonly tokenService: TokenService,
    protected readonly codec: ProtocolCodec,
    protected readonly rateLimiter?: RateLimiter,
  ) {}
  protected async auth(ctx: HttpRequestContext, operation: string) {
    const auth = await verifyAccessToken(
      this.tokenService,
      extractBearerToken(ctx.request.headers.get("authorization")),
    );
    this.safety.sanctions.requireApplicationAccess(auth.userId);
    if (this.rateLimiter) {
      requireHttpRateLimit(
        this.rateLimiter,
        "moderation." + operation + ":" + auth.userId,
        "Too many moderation operations. Try again later.",
      );
    }
    return auth;
  }
}

export class ListReportsRoute extends ModerationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/moderation/reports";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "reports-list");
    const input = page(ctx.request);
    const status = optionalEnumParam(input.url, "status", REPORT_STATUSES);
    const targetType = optionalEnumParam(
      input.url,
      "targetType",
      ["user", "message", "attachment"] as const,
    );
    const assignedToMe = input.url.searchParams.get("assignedToMe") === "true";
    return successResponse(
      this.codec,
      this.safety.listReports(
        auth.userId,
        {
          ...(status ? { status } : {}),
          ...(targetType ? { targetType } : {}),
          ...(assignedToMe ? { assignedModeratorId: auth.userId } : {}),
        },
        input.cursor,
        input.limit,
      ),
      200,
    );
  }
}
export class GetReportRoute extends ModerationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/moderation/reports/:reportId";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "report-get");
    return successResponse(this.codec, {
      report: this.safety.getReport(auth.userId, requireString(ctx.params, "reportId")),
    }, 200);
  }
}
export class GetReportContextRoute extends ModerationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/moderation/reports/:reportId/context";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "report-context");
    const url = new URL(ctx.request.url);
    const before = Number(url.searchParams.get("before") ?? 10);
    const after = Number(url.searchParams.get("after") ?? 10);
    if (
      !Number.isInteger(before) || before < 0 || before > 20 ||
      !Number.isInteger(after) || after < 0 || after > 20
    ) {
      throw new ValidationError("before and after must be integers between 0 and 20.");
    }
    return successResponse(
      this.codec,
      this.safety.getReportContext(
        auth.userId,
        requireString(ctx.params, "reportId"),
        before,
        after,
      ),
      200,
    );
  }
}
export class AssignReportRoute extends ModerationRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/moderation/reports/:reportId/assign";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "report-assign");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const expected = body.expectedAssigneeId === null
      ? null
      : optionalString(body, "expectedAssigneeId", { maxLength: 100 }) ?? null;
    const moderatorId = optionalString(body, "moderatorId", { maxLength: 100 }) ?? null;
    return successResponse(this.codec, {
      report: this.safety.assignReport(
        auth.userId,
        requireString(ctx.params, "reportId"),
        expected,
        moderatorId,
      ),
    }, 200);
  }
}
export class TransitionReportRoute extends ModerationRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/moderation/reports/:reportId/status";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "report-status");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    return successResponse(this.codec, {
      report: this.safety.transitionReport(
        auth.userId,
        requireString(ctx.params, "reportId"),
        requireEnum(body, "expectedStatus", REPORT_STATUSES),
        requireEnum(body, "nextStatus", REPORT_STATUSES),
      ),
    }, 200);
  }
}
export class ListSanctionsRoute extends ModerationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/moderation/users/:userId/sanctions";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "sanctions-list");
    const input = page(ctx.request);
    return successResponse(
      this.codec,
      this.safety.listSanctions(
        auth.userId,
        requireString(ctx.params, "userId"),
        input.url.searchParams.get("activeOnly") !== "false",
        input.cursor,
        input.limit,
      ),
      200,
    );
  }
}
export class ApplySanctionRoute extends ModerationRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/moderation/users/:userId/sanctions";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "sanction-apply");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const sanction = this.safety.applySanction(
      auth.userId,
      requireString(ctx.params, "userId"),
      requireEnum(body, "type", SANCTION_TYPES),
      requireString(body, "reasonCode", { minLength: 1, maxLength: 100 }),
      optionalString(body, "moderatorNote", { maxLength: 2000 }) ?? null,
      optionalString(body, "startsAt", { maxLength: 40 }) ?? null,
      optionalString(body, "expiresAt", { maxLength: 40 }) ?? null,
    );
    return successResponse(this.codec, { sanction }, 201);
  }
}
export class RevokeSanctionRoute extends ModerationRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/moderation/sanctions/:sanctionId/revoke";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "sanction-revoke");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    return successResponse(this.codec, {
      sanction: this.safety.revokeSanction(
        auth.userId,
        requireString(ctx.params, "sanctionId"),
        optionalString(body, "reason", { maxLength: 500 }) ?? null,
      ),
    }, 200);
  }
}
export class ListAuditEventsRoute extends ModerationRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/admin/audit-events";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "audit-list");
    const input = page(ctx.request);
    const actionCode = input.url.searchParams.get("actionCode");
    const actorUserId = input.url.searchParams.get("actorUserId");
    const targetType = input.url.searchParams.get("targetType");
    const targetId = input.url.searchParams.get("targetId");
    return successResponse(
      this.codec,
      this.safety.listAudit(
        auth.userId,
        {
          ...(actionCode ? { actionCode } : {}),
          ...(actorUserId ? { actorUserId } : {}),
          ...(targetType ? { targetType } : {}),
          ...(targetId ? { targetId } : {}),
        },
        input.cursor,
        input.limit,
      ),
      200,
    );
  }
}
