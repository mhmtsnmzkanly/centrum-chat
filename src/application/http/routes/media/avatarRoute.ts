import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import { successResponse } from "../../responses.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { AttachmentService } from "../../../../domain/attachments/attachmentService.ts";
import type { UserService } from "../../../../domain/users/userService.ts";
import type { RateLimiter } from "../../../../shared/rateLimit/rateLimiter.ts";
import type { AccountPolicy } from "../../../../domain/auth/accountPolicy.ts";
import type { SanctionPolicy } from "../../../../domain/safety/safetyPolicy.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { requireHttpRateLimit } from "../../rateLimitGuard.ts";
import { extractSingleFile } from "./multipart.ts";
import { deleteMediaFile, writeMediaFile } from "./mediaStorage.ts";
import { requireSupportedImageMimeType } from "./uploadValidation.ts";
import type { SettingsService } from "../../../../domain/administration/settingsService.ts";
import type { RuntimePolicy } from "../../../../domain/administration/runtimePolicy.ts";

/** `avatarUrl` is always `/media/:id`; extracts the `:id` back out to look up (and
 * delete) the attachment row + file it used to point at. Returns null for anything else
 * (e.g. no avatar set yet), which is a no-op for the caller. */
function attachmentIdFromAvatarUrl(avatarUrl: string): string | null {
  const match = /^\/media\/(.+)$/.exec(avatarUrl);
  return match?.[1] ?? null;
}

/** docs/04-http-api.md "POST /api/media/avatar". Unlike a regular upload, this is a
 * single step that both stores the file and updates `users.avatar_url` — there's no
 * separate "attach" step since an avatar is never linked to a message. */
export class AvatarRoute implements RouteHandler {
  readonly method = "POST" as const;
  readonly path = "/api/media/avatar";
  private readonly accountPolicy: Pick<AccountPolicy, "requireVerifiedEmail">;

  constructor(
    private readonly tokenService: TokenService,
    private readonly attachmentService: AttachmentService,
    private readonly userService: UserService,
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
        `media.avatar:${auth.userId}`,
        "Too many avatar uploads. Try again later.",
      );
    }
    this.accountPolicy.requireVerifiedEmail(auth.userId);
    this.sanctionPolicy?.requireApplicationAccess(auth.userId);
    this.runtimePolicy?.requireMutation(auth.userId);

    const maxSize = this.settings?.effectiveUploadLimit("max_avatar_size_bytes") ??
      this.maxSizeBytes;
    const { fileName, bytes } = await extractSingleFile(ctx.request, maxSize);
    const mimeType = requireSupportedImageMimeType(bytes);

    const storagePath = `profile/${crypto.randomUUID()}`;
    await writeMediaFile(this.mediaRoot, storagePath, bytes);

    let attachment;
    try {
      attachment = this.attachmentService.recordUpload({
        uploaderId: auth.userId,
        kind: "avatar",
        fileName,
        mimeType,
        sizeBytes: bytes.length,
        storagePath,
      });
    } catch (error) {
      await deleteMediaFile(this.mediaRoot, storagePath);
      throw error;
    }
    const avatarUrl = `/media/${attachment.id}`;

    const { previousAvatarUrl } = this.userService.setAvatarUrl(auth.userId, avatarUrl);
    if (previousAvatarUrl) {
      const previousId = attachmentIdFromAvatarUrl(previousAvatarUrl);
      const previousAttachment = previousId ? this.attachmentService.findById(previousId) : null;
      if (previousAttachment) {
        this.attachmentService.delete(previousAttachment.id);
        await deleteMediaFile(this.mediaRoot, previousAttachment.storagePath);
      }
    }

    return successResponse(this.codec, { avatarUrl }, 200);
  }
}
