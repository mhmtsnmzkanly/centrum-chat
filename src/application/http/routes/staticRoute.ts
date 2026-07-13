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

      let rel = relativePath.replace(/\\/g, "/");
      if (rel.startsWith("/")) {
        rel = rel.slice(1);
      }

      // Prevent path traversal
      if (rel.includes("\0")) {
        return errorResponse(this.codec, { code: "FORBIDDEN", message: "Access denied." }, 403);
      }
      const segments = rel.split("/");
      if (segments.some((seg) => seg === ".." || seg === ".")) {
        return errorResponse(this.codec, { code: "FORBIDDEN", message: "Access denied." }, 403);
      }

      // Candidate paths in order of precedence:
      // 1. Exact file request
      const pathA = `${this.baseDir}/${rel}`;
      // 2. Extensionless page request (matching sibling .html)
      const pathB = rel !== "" ? `${this.baseDir}/${rel}.html` : "";
      // 3. Directory fallback (directory/index.html)
      const pathC = rel === "" ? `${this.baseDir}/index.html` : `${this.baseDir}/${rel}/index.html`;

      let opened: { file: Deno.FsFile; size: number } | null = null;
      let resolvedPath = "";

      // Try Candidate 1: Exact file
      opened = await tryOpenFile(pathA);
      if (opened) {
        resolvedPath = pathA;
      }

      // Try Candidate 2: Extensionless .html
      if (!opened && pathB !== "") {
        opened = await tryOpenFile(pathB);
        if (opened) {
          resolvedPath = pathB;
        }
      }

      // Try Candidate 3: Directory index.html
      if (!opened) {
        opened = await tryOpenFile(pathC);
        if (opened) {
          resolvedPath = pathC;
        }
      }

      if (!opened) {
        return errorResponse(this.codec, { code: "NOT_FOUND", message: "File not found." }, 404);
      }

      // Determine content type
      const ext = resolvedPath.split(".").pop()?.toLowerCase() || "";
      const contentTypes: Record<string, string> = {
        html: "text/html; charset=utf-8",
        css: "text/css; charset=utf-8",
        js: "application/javascript; charset=utf-8",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        svg: "image/svg+xml",
        ico: "image/x-icon",
        json: "application/json; charset=utf-8",
      };
      const contentType = contentTypes[ext] || "application/octet-stream";

      return new Response(opened.file.readable, {
        status: 200,
        headers: {
          "content-type": contentType,
          "content-length": String(opened.size),
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

async function tryOpenFile(path: string): Promise<{ file: Deno.FsFile; size: number } | null> {
  try {
    const file = await Deno.open(path, { read: true });
    const stat = await file.stat();
    if (stat.isFile) {
      return { file, size: stat.size };
    }
    file.close();
  } catch (_) {
    // ignore
  }
  return null;
}
