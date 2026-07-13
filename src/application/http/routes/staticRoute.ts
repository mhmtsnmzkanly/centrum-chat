import type { HttpRequestContext, RouteHandler } from "../routeHandler.ts";
import type { ProtocolCodec } from "../../../protocol/protocolCodec.ts";
import { errorResponse } from "../responses.ts";

/** Route handler to serve static assets from the web/ directory. */
export class StaticRoute implements RouteHandler {
  readonly method = "GET" as const;

  constructor(
    readonly path: string,
    private readonly baseDir: string,
    private readonly codec: ProtocolCodec,
  ) {}

  async handle(ctx: HttpRequestContext): Promise<Response> {
    try {
      let relativePath = ctx.params["*"] || "";
      try {
        relativePath = decodeURIComponent(relativePath);
      } catch (_) {
        // ignore decoding errors
      }

      if (relativePath.startsWith("/")) {
        relativePath = relativePath.slice(1);
      }

      // Prevent path traversal
      const segments = relativePath.split("/");
      if (segments.some((seg) => seg === ".." || seg === ".")) {
        return errorResponse(this.codec, { code: "FORBIDDEN", message: "Access denied." }, 403);
      }

      // Check if trying to access directory root, map to index.html
      const isRoot = relativePath === "" || relativePath === "index.html";
      const targetPath = isRoot ? `${this.baseDir}/index.html` : `${this.baseDir}/${relativePath}`;

      let file = await Deno.open(targetPath, { read: true });
      let stat = await file.stat();
      if (stat.isDirectory) {
        file.close();
        const indexPath = targetPath.endsWith("/")
          ? `${targetPath}index.html`
          : `${targetPath}/index.html`;
        try {
          file = await Deno.open(indexPath, { read: true });
          stat = await file.stat();
        } catch (_) {
          return errorResponse(this.codec, { code: "NOT_FOUND", message: "File not found." }, 404);
        }
      }

      // Determine content type
      const ext = targetPath.split(".").pop()?.toLowerCase() || "";
      const contentTypes: Record<string, string> = {
        html: "text/html",
        css: "text/css",
        js: "application/javascript",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        svg: "image/svg+xml",
        ico: "image/x-icon",
        json: "application/json",
      };
      const contentType = contentTypes[ext] || "application/octet-stream";

      return new Response(file.readable, {
        status: 200,
        headers: {
          "content-type": contentType,
          "content-length": String(stat.size),
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
