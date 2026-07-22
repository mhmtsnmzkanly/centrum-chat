// Deno's URL.hostname retains brackets around an IPv6 literal, unlike many
// browser implementations. Accept its exact parsed representation only.
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface CapacityHarnessConfig {
  readonly target: URL;
  readonly clients: number;
  readonly token: string | undefined;
  readonly allowRemote: boolean;
  readonly smoke: boolean;
}

function readOptions(args: readonly string[]): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Options must be passed as --name value pairs.");
    }
    options.set(key, value);
  }
  return options;
}

function parseBooleanOption(options: ReadonlyMap<string, string>, name: string): boolean {
  const value = options.get(name);
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}

function parseTarget(value: string): URL {
  try {
    const target = new URL(value);
    if (target.protocol !== "ws:" && target.protocol !== "wss:") {
      throw new Error();
    }
    return target;
  } catch {
    throw new Error("--target must be a ws:// or wss:// URL.");
  }
}

export function parseCapacityHarnessConfig(args: readonly string[]): CapacityHarnessConfig {
  const options = readOptions(args);
  const target = parseTarget(options.get("--target") ?? "ws://127.0.0.1:8080/ws");
  const clients = Number(options.get("--clients") ?? "2");
  const allowRemote = parseBooleanOption(options, "--allow-remote");
  const smoke = parseBooleanOption(options, "--smoke");

  if (!Number.isInteger(clients) || clients < 1 || clients > 1000) {
    throw new Error("--clients must be 1..1000");
  }
  if (!LOCAL_HOSTNAMES.has(target.hostname) && !allowRemote) {
    throw new Error("Remote targets require --allow-remote true.");
  }

  return { target, clients, token: options.get("--token"), allowRemote, smoke };
}
