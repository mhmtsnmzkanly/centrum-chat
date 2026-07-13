import type { RouteHandler } from "./routeHandler.ts";

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  if (pattern === "*") {
    return { "*": pathname };
  }
  const patternParts = pattern.split("/").filter((part) => part.length > 0);
  const pathParts = pathname.split("/").filter((part) => part.length > 0);

  const hasWildcard = patternParts.length > 0 && patternParts[patternParts.length - 1] === "*";
  if (!hasWildcard && patternParts.length !== pathParts.length) return null;
  if (hasWildcard && pathParts.length < patternParts.length - 1) return null;

  const params: Record<string, string> = {};
  const limit = hasWildcard ? patternParts.length - 1 : patternParts.length;

  for (let i = 0; i < limit; i++) {
    const patternPart = patternParts[i] as string;
    const pathPart = pathParts[i] as string;
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return null;
    }
  }

  if (hasWildcard) {
    const remaining = pathParts.slice(limit).map(decodeURIComponent).join("/");
    params["*"] = remaining;
  }

  return params;
}

/** Explicit registration list -> (method, path pattern) -> handler. The transport layer
 * calls dispatch() exactly once per request; it never inspects the path itself. */
export class RouteRegistry {
  private readonly handlers: RouteHandler[] = [];

  register(handler: RouteHandler): void {
    this.handlers.push(handler);
  }

  async dispatch(request: Request, clientIp: string): Promise<Response | null> {
    const url = new URL(request.url);
    for (const handler of this.handlers) {
      if (handler.method !== request.method) continue;
      const params = matchPath(handler.path, url.pathname);
      if (params === null) continue;
      return await handler.handle({ request, params, clientIp });
    }
    return null;
  }
}
