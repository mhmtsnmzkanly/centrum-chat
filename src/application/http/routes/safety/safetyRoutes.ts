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
import { REPORT_REASONS } from "../../../../domain/safety/safety.entity.ts";
import { ValidationError } from "../../../../shared/errors/validationError.ts";
import type { RuntimePolicy } from "../../../../domain/administration/runtimePolicy.ts";

function pageInput(request: Request): { cursor: string | null; limit: number } {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const raw = url.searchParams.get("limit");
  const limit = raw === null ? 25 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError("limit must be an integer between 1 and 100.");
  }
  return { cursor, limit };
}

abstract class AuthenticatedSafetyRoute {
  constructor(
    protected readonly safety: SafetyService,
    protected readonly tokenService: TokenService,
    protected readonly codec: ProtocolCodec,
    protected readonly rateLimiter?: RateLimiter,
    protected readonly runtimePolicy?: RuntimePolicy,
  ) {}
  protected async auth(ctx: HttpRequestContext, operation: string) {
    const auth = await verifyAccessToken(
      this.tokenService,
      extractBearerToken(ctx.request.headers.get("authorization")),
    );
    this.safety.sanctions.requireApplicationAccess(auth.userId);
    this.runtimePolicy?.requireMutation(auth.userId);
    if (this.rateLimiter) {
      requireHttpRateLimit(
        this.rateLimiter,
        "safety." + operation + ":" + auth.userId,
        "Too many safety operations. Try again later.",
      );
    }
    return auth;
  }
}

export class BlockUserRoute extends AuthenticatedSafetyRoute implements RouteHandler {
  readonly method = "PUT" as const;
  readonly path = "/api/safety/blocks/:userId";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "block");
    return successResponse(
      this.codec,
      this.safety.block(auth.userId, requireString(ctx.params, "userId")),
      200,
    );
  }
}
export class UnblockUserRoute extends AuthenticatedSafetyRoute implements RouteHandler {
  readonly method = "DELETE" as const;
  readonly path = "/api/safety/blocks/:userId";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "unblock");
    return successResponse(
      this.codec,
      this.safety.unblock(auth.userId, requireString(ctx.params, "userId")),
      200,
    );
  }
}
export class ListBlockedUsersRoute extends AuthenticatedSafetyRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/api/safety/blocks";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "list-blocks");
    const { cursor, limit } = pageInput(ctx.request);
    return successResponse(this.codec, this.safety.listBlocked(auth.userId, cursor, limit), 200);
  }
}
export class CreateReportRoute extends AuthenticatedSafetyRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/safety/reports";
  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await this.auth(ctx, "report");
    const body = asRecord(decodeJsonBody(this.codec, await ctx.request.text()));
    const targetType = requireEnum(body, "targetType", ["user", "message", "attachment"] as const);
    const targetId = requireString(body, "targetId", { maxLength: 100 });
    const reasonCode = requireEnum(body, "reasonCode", REPORT_REASONS);
    const details = optionalString(body, "details", { maxLength: 2000 }) ?? null;
    const report = this.safety.createReport(
      auth.userId,
      targetType,
      targetId,
      reasonCode,
      details,
    );
    return successResponse(this.codec, {
      report: {
        id: report.id,
        targetType: report.targetType,
        reasonCode: report.reasonCode,
        status: report.status,
        createdAt: report.createdAt,
      },
    }, 201);
  }
}
