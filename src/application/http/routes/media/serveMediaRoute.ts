import type { HttpRequestContext, RouteHandler } from "../../routeHandler.ts";
import type { ProtocolCodec } from "../../../../protocol/protocolCodec.ts";
import { errorResponse } from "../../responses.ts";
import type { TokenService } from "../../../../domain/auth/tokenService.ts";
import type { AttachmentService } from "../../../../domain/attachments/attachmentService.ts";
import type { MessageRepository } from "../../../../domain/messages/messageRepository.port.ts";
import type { ConversationRepository } from "../../../../domain/conversations/conversationRepository.port.ts";
import type { PermissionService } from "../../../../domain/permissions/permissionService.ts";
import { extractBearerToken, verifyAccessToken } from "../../../middleware/authMiddleware.ts";
import { ForbiddenError } from "../../../../shared/errors/forbiddenError.ts";
import { NotFoundError } from "../../../../shared/errors/notFoundError.ts";
import { openMediaFile } from "./mediaStorage.ts";

/** docs/04-http-api.md "GET /media/:id": avatars are served unauthenticated (an `<img>`
 * tag never sends an `Authorization` header); message attachments are gated by the same
 * access rule as `message.history` for the room the owning message lives in. An
 * attachment not yet linked to a message (mid-compose, before `message.send`) has no
 * owning room to check against, so it only requires *some* valid caller — matching the
 * bar for every other authenticated action in this app. */
export class ServeMediaRoute implements RouteHandler {
  readonly method = "GET" as const;
  readonly path = "/media/:id";

  constructor(
    private readonly attachmentService: AttachmentService,
    private readonly messageRepository: MessageRepository,
    private readonly roomRepository: ConversationRepository,
    private readonly permissionService: PermissionService,
    private readonly tokenService: TokenService,
    private readonly mediaRoot: string,
    private readonly codec: ProtocolCodec,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    const id = ctx.params["id"];
    if (!id) {
      return errorResponse(this.codec, { code: "NOT_FOUND", message: "No such route." }, 404);
    }

    const attachment = this.attachmentService.findById(id);
    if (!attachment) {
      throw new NotFoundError("Attachment not found.", { id });
    }

    if (attachment.kind === "attachment") {
      await this.requireAttachmentAccess(ctx, attachment);
    }

    const file = await openMediaFile(this.mediaRoot, attachment.storagePath);
    if (!file) {
      throw new NotFoundError("Attachment file is missing on disk.", { id });
    }
    return new Response(file.readable, {
      status: 200,
      headers: {
        "content-type": attachment.mimeType,
        "content-length": String(attachment.sizeBytes),
        "content-disposition": attachment.kind === "attachment"
          ? `attachment; ${escapeDispositionFileName(attachment.fileName)}`
          : `inline; ${escapeDispositionFileName(attachment.fileName)}`,
        "cache-control": attachment.kind === "attachment"
          ? "private, no-store"
          : "public, max-age=300",
      },
    });
  }

  private async requireAttachmentAccess(
    ctx: HttpRequestContext,
    attachment: { readonly messageId: string | null; readonly uploaderId: string | null },
  ): Promise<void> {
    // `<img>`/`<a download>` tags cannot send an Authorization header, so a
    // `?token=` query param is accepted as a fallback — same mechanism the
    // WebSocket upgrade uses (docs/04-http-api.md "GET /media/:id").
    const bearerToken = extractBearerToken(ctx.request.headers.get("authorization")) ??
      new URL(ctx.request.url).searchParams.get("token");
    const auth = await verifyAccessToken(this.tokenService, bearerToken);
    const userId = auth.userId;
    if (!attachment.messageId) {
      if (attachment.uploaderId !== userId) {
        throw new ForbiddenError("You cannot access an attachment uploaded by another user.");
      }
      return;
    }

    const message = this.messageRepository.findById(attachment.messageId);
    const room = message ? this.roomRepository.findById(message.conversationId) : null;
    if (!message || !room) {
      throw new NotFoundError("Attachment not found.");
    }
    this.permissionService.requireAccess(room, userId);
  }
}

function escapeDispositionFileName(fileName: string): string {
  const safe = fileName.replaceAll("\\", "_").replaceAll('"', "_");
  const isPureAscii = /^[\x20-\x7E]*$/.test(safe);
  if (isPureAscii) {
    return `filename="${safe}"`;
  }
  const safeAscii = [...safe]
    .map((char) => {
      const code = char.charCodeAt(0);
      return (code < 0x20 || code > 0x7e) ? "_" : char;
    })
    .join("");
  const encoded = encodeURIComponent(fileName)
    .replaceAll("'", "%27")
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("*", "%2A");
  return `filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}
