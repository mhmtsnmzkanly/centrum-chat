import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { AttachmentService } from "../../../../domain/attachments/attachmentService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import type { AccountPolicy } from "../../../../domain/auth/accountPolicy.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";
import { extractSingleFile } from "./multipart.ts";
import { deleteMediaFile, writeMediaFile } from "./mediaStorage.ts";
import type { SanctionPolicy } from "../../../../domain/safety/safetyPolicy.ts";
import type { SettingsService } from "../../../../domain/administration/settingsService.ts";
import type { RuntimePolicy } from "../../../../domain/administration/runtimePolicy.ts";

/** docs/04-http-api.md "POST /api/media/upload". The returned `attachmentId` is later
 * passed to `message.send`'s `attachmentId` field to link the upload to a message; if
 * that never happens within the configured window, the orphan-cleanup job removes it
 * (main.ts). */
export class UploadRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/media/upload";
  private readonly accountPolicy: Pick<AccountPolicy, "requireVerifiedEmail">;

  constructor(
    private readonly tokenService: TokenService,
    private readonly attachmentService: AttachmentService,
    private readonly mediaRoot: string,
    private readonly maxSizeBytes: number,
    private readonly codec: ProtocolCodec,
    private readonly rateLimiter?: RateLimiter,
    accountPolicy?: Pick<AccountPolicy, "requireVerifiedEmail">,
    private readonly sanctionPolicy?: SanctionPolicy,
    private readonly settings?: SettingsService,
    private readonly runtimePolicy?: RuntimePolicy,
  ) {
    this.accountPolicy = accountPolicy ?? { requireVerifiedEmail() {} };
  }

  async handle(ctx: HttpRequestContext): Promise<Response> {
    const auth = await verifyAccessToken(
      this.tokenService,
      extractBearerToken(ctx.request.headers.get("authorization")),
    );
    if (this.rateLimiter) {
      requireHttpRateLimit(
        this.rateLimiter,
        `media.upload:${auth.userId}`,
        "Too many attachment uploads. Try again later.",
      );
    }
    this.accountPolicy.requireVerifiedEmail(auth.userId);
    this.sanctionPolicy?.requireCanMessage(auth.userId);
    this.runtimePolicy?.requireMutation(auth.userId);

    const maxSize = this.settings?.effectiveUploadLimit("max_upload_size_bytes") ??
      this.maxSizeBytes;
    const { fileName, mimeType, bytes } = await extractSingleFile(ctx.request, maxSize);

    const storagePath = `attachments/${crypto.randomUUID()}`;
    await writeMediaFile(this.mediaRoot, storagePath, bytes);

    let attachment;
    try {
      attachment = this.attachmentService.recordUpload({
        uploaderId: auth.userId,
        kind: "attachment",
        fileName,
        mimeType,
        sizeBytes: bytes.length,
        storagePath,
      });
    } catch (error) {
      await deleteMediaFile(this.mediaRoot, storagePath);
      throw error;
    }

    return successResponse(
      this.codec,
      {
        attachmentId: attachment.id,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        url: `/media/${attachment.id}`,
      },
      201,
    );
  }
}
