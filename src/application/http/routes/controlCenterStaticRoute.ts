import type { HttpRequestContext, RouteHandler } from "../routeHandler.ts";
import type { ProtocolCodec } from "../../../protocol/protocolCodec.ts";
import { errorResponse } from "../responses.ts";

const ASSETS = new Map<string, string>([
  ["index.html", "text/html; charset=utf-8"],
  ["control-center.css", "text/css; charset=utf-8"],
  ["control-center.js", "text/javascript; charset=utf-8"],
  ["api/contract.js", "text/javascript; charset=utf-8"],
  ["api/controlCenterApi.js", "text/javascript; charset=utf-8"],
  ["api/errors.js", "text/javascript; charset=utf-8"],
  ["state/store.js", "text/javascript; charset=utf-8"],
  ["ui/audit.js", "text/javascript; charset=utf-8"],
  ["ui/channels.js", "text/javascript; charset=utf-8"],
  ["ui/common.js", "text/javascript; charset=utf-8"],
  ["ui/dialogs.js", "text/javascript; charset=utf-8"],
  ["ui/moderation.js", "text/javascript; charset=utf-8"],
  ["ui/navigation.js", "text/javascript; charset=utf-8"],
  ["ui/owner.js", "text/javascript; charset=utf-8"],
  ["ui/roles.js", "text/javascript; charset=utf-8"],
  ["ui/settings.js", "text/javascript; charset=utf-8"],
  ["ui/shell.js", "text/javascript; charset=utf-8"],
  ["ui/users.js", "text/javascript; charset=utf-8"],
]);

export class ControlCenterStaticRoute implements RouteHandler {
  readonly method = "GET" as const;

  constructor(
    readonly path: "/control-center" | "/control-center/*",
    private readonly baseDir: string,
    private readonly codec: ProtocolCodec,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    const relative = this.path === "/control-center"
      ? "index.html"
      : (ctx.params["*"] || "index.html");
    const normalized = relative === "" ? "index.html" : relative;
    const contentType = ASSETS.get(normalized);
    if (!contentType) {
      return errorResponse(this.codec, { code: "NOT_FOUND", message: "File not found." }, 404);
    }
    try {
      const file = await Deno.open(`${this.baseDir}/${normalized}`, { read: true });
      const stat = await file.stat();
      if (!stat.isFile) {
        file.close();
        return errorResponse(this.codec, { code: "NOT_FOUND", message: "File not found." }, 404);
      }
      return new Response(file.readable, {
        headers: {
          "content-length": String(stat.size),
          "content-type": contentType,
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return errorResponse(this.codec, { code: "NOT_FOUND", message: "File not found." }, 404);
      }
      throw error;
    }
  }
}
