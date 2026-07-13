/**
 * Central trusted-proxy / client-IP policy (docs/09, AGENTS.md §10).
 *
 * The application normally treats the TCP peer as the client. When it runs behind a
 * reverse proxy (Cloudflare → Caddy → app), the peer is always the proxy, so IP-keyed
 * rate limits and the WebSocket per-IP quota would collapse into one shared bucket.
 *
 * Trust model — the only place forwarded headers are ever interpreted:
 *
 * - Forwarded IP information is accepted **only** when the direct socket peer is listed
 *   in `TRUSTED_PROXY_IPS` (exact IPs or CIDR blocks). Any other peer gets its socket IP,
 *   and its forwarded headers are ignored entirely (spoofing has no effect).
 * - Only `X-Forwarded-For` is consulted. `CF-Connecting-IP`, `X-Real-IP`, `Forwarded`,
 *   `Host`, and `Origin` are never used as an IP authority: the proxy in front of the
 *   app is responsible for folding the edge's knowledge into `X-Forwarded-For`.
 * - The chain is resolved right-to-left: entries appended by our own trusted proxies are
 *   skipped, and the first (right-most) entry NOT in the trusted set is the client — the
 *   value attested by the nearest trusted hop. Left of that point the header is
 *   client-controlled noise and is never inspected.
 * - Fail-safe fallbacks return the socket IP: an empty header, a malformed/empty chain
 *   entry encountered during the walk, or a chain consisting solely of trusted proxies
 *   (a request originating from the proxy itself, e.g. a health probe).
 * - IPv4 and IPv6 both supported; IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is normalized to
 *   dotted IPv4 and IPv6 output uses the RFC 5952 compressed form, so one real client
 *   cannot occupy several rate-limit buckets via alternative spellings, and `::1` vs
 *   `127.0.0.1` trust entries behave predictably on dual-stack listeners.
 *
 * With `TRUSTED_PROXY_IPS` unset (the default) behavior is identical to the historical
 * one: every request is keyed by its socket peer.
 */

interface ParsedIp {
  readonly family: "v4" | "v6";
  /** 4 bytes for v4, 16 for v6. */
  readonly bytes: Uint8Array;
}

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV4_WITH_PORT_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/;
const HEX_GROUP_PATTERN = /^[0-9a-f]{1,4}$/;

function parseIpv4(text: string): ParsedIp | null {
  const match = IPV4_PATTERN.exec(text);
  if (!match) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = match[i + 1];
    if (part === undefined) return null;
    // Reject leading zeros: some stacks read "010" as octal, which would let one
    // address take on several textual identities.
    if (part.length > 1 && part.startsWith("0")) return null;
    const value = Number.parseInt(part, 10);
    if (value > 255) return null;
    bytes[i] = value;
  }
  return { family: "v4", bytes };
}

function parseIpv6(text: string): ParsedIp | null {
  const lowered = text.toLowerCase();
  // Zone indexes (fe80::1%eth0) are link-local plumbing, never a public client identity.
  if (lowered.includes("%")) return null;

  const doubleColonIndex = lowered.indexOf("::");
  if (doubleColonIndex !== lowered.lastIndexOf("::")) return null;

  const splitGroups = (part: string): string[] => part === "" ? [] : part.split(":");

  let headGroups: string[];
  let tailGroups: string[];
  if (doubleColonIndex >= 0) {
    headGroups = splitGroups(lowered.slice(0, doubleColonIndex));
    tailGroups = splitGroups(lowered.slice(doubleColonIndex + 2));
  } else {
    headGroups = splitGroups(lowered);
    tailGroups = [];
  }

  // An embedded IPv4 suffix (e.g. ::ffff:192.0.2.1) may appear only as the last group.
  const groupsToWords = (groups: string[], isTail: boolean): number[] | null => {
    const words: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (group === undefined || group === "") return null;
      const isLast = i === groups.length - 1 && (isTail || doubleColonIndex < 0);
      if (isLast && group.includes(".")) {
        const embedded = parseIpv4(group);
        if (!embedded) return null;
        const b = embedded.bytes;
        words.push(((b[0] ?? 0) << 8) | (b[1] ?? 0), ((b[2] ?? 0) << 8) | (b[3] ?? 0));
        continue;
      }
      if (!HEX_GROUP_PATTERN.test(group)) return null;
      words.push(Number.parseInt(group, 16));
    }
    return words;
  };

  const headWords = groupsToWords(headGroups, false);
  const tailWords = groupsToWords(tailGroups, true);
  if (headWords === null || tailWords === null) return null;

  const total = headWords.length + tailWords.length;
  let words: number[];
  if (doubleColonIndex >= 0) {
    // "::" stands for at least one zero group.
    if (total > 7) return null;
    words = [...headWords, ...new Array<number>(8 - total).fill(0), ...tailWords];
  } else {
    if (total !== 8) return null;
    words = headWords;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const word = words[i] ?? 0;
    bytes[i * 2] = word >> 8;
    bytes[i * 2 + 1] = word & 0xff;
  }

  // Normalize IPv4-mapped addresses to plain IPv4 so trust entries and bucket keys
  // agree regardless of whether the listener reported the peer as v4 or mapped v6.
  const isV4Mapped = bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10] === 0xff && bytes[11] === 0xff;
  if (isV4Mapped) {
    return { family: "v4", bytes: bytes.slice(12) };
  }
  return { family: "v6", bytes };
}

/** Parses an IPv4 or IPv6 address (no port, no brackets). Returns null when invalid. */
export function parseIpAddress(text: string): ParsedIp | null {
  if (text.includes(":")) return parseIpv6(text);
  return parseIpv4(text);
}

/** Canonical textual form: dotted IPv4, or RFC 5952 compressed lowercase IPv6. */
export function formatIpAddress(ip: ParsedIp): string {
  if (ip.family === "v4") {
    return `${ip.bytes[0]}.${ip.bytes[1]}.${ip.bytes[2]}.${ip.bytes[3]}`;
  }
  const words: number[] = [];
  for (let i = 0; i < 8; i++) {
    words.push(((ip.bytes[i * 2] ?? 0) << 8) | (ip.bytes[i * 2 + 1] ?? 0));
  }
  // Find the longest run of zero words (length >= 2, leftmost wins) to compress as "::".
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let i = 0; i <= 8; i++) {
    if (i < 8 && words[i] === 0) {
      if (runStart < 0) runStart = i;
      continue;
    }
    if (runStart >= 0) {
      const length = i - runStart;
      if (length >= 2 && length > bestLength) {
        bestStart = runStart;
        bestLength = length;
      }
      runStart = -1;
    }
  }
  if (bestStart < 0) {
    return words.map((w) => w.toString(16)).join(":");
  }
  const head = words.slice(0, bestStart).map((w) => w.toString(16)).join(":");
  const tail = words.slice(bestStart + bestLength).map((w) => w.toString(16)).join(":");
  return `${head}::${tail}`;
}

/**
 * Strips an optional port from a forwarded-chain entry: `[2001:db8::1]:443`,
 * `[2001:db8::1]`, and `192.0.2.1:443` forms. Bare addresses pass through unchanged
 * (a bare IPv6 with colons is never mistaken for host:port).
 */
function stripPortAndBrackets(entry: string): string | null {
  if (entry.startsWith("[")) {
    const closing = entry.indexOf("]");
    if (closing < 0) return null;
    const suffix = entry.slice(closing + 1);
    if (suffix !== "") {
      if (!/^:\d{1,5}$/.test(suffix)) return null;
      const port = Number.parseInt(suffix.slice(1), 10);
      if (port < 1 || port > 65_535) return null;
    }
    return entry.slice(1, closing);
  }
  if (IPV4_WITH_PORT_PATTERN.test(entry)) {
    const port = Number.parseInt(entry.slice(entry.lastIndexOf(":") + 1), 10);
    if (port < 1 || port > 65_535) return null;
    return entry.slice(0, entry.lastIndexOf(":"));
  }
  return entry;
}

interface TrustedNetwork {
  readonly ip: ParsedIp;
  readonly prefixLength: number;
}

export interface TrustedProxyMatcher {
  isTrusted(ip: ParsedIp): boolean;
  /** True when no trusted proxies are configured — forwarded headers are never read. */
  readonly isEmpty: boolean;
}

function matchesNetwork(ip: ParsedIp, network: TrustedNetwork): boolean {
  if (ip.family !== network.ip.family) return false;
  const fullBytes = network.prefixLength >> 3;
  for (let i = 0; i < fullBytes; i++) {
    if (ip.bytes[i] !== network.ip.bytes[i]) return false;
  }
  const remainingBits = network.prefixLength & 7;
  if (remainingBits === 0) return true;
  const mask = 0xff << (8 - remainingBits) & 0xff;
  return ((ip.bytes[fullBytes] ?? 0) & mask) === ((network.ip.bytes[fullBytes] ?? 0) & mask);
}

/**
 * Builds a matcher from `TRUSTED_PROXY_IPS` entries: exact IPs (`127.0.0.1`, `::1`) or
 * CIDR blocks (`10.0.0.0/8`, `2400:cb00::/32`). Throws on any malformed entry so a
 * config typo fails the boot instead of silently disabling (or widening) trust.
 */
export function createTrustedProxyMatcher(entries: readonly string[]): TrustedProxyMatcher {
  const networks: TrustedNetwork[] = [];
  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (entry === "") continue;
    const slashIndex = entry.indexOf("/");
    const ipText = slashIndex >= 0 ? entry.slice(0, slashIndex) : entry;
    const ip = parseIpAddress(ipText);
    if (!ip) {
      throw new Error(`Invalid trusted proxy entry (not an IP or CIDR): ${entry}`);
    }
    const maxPrefix = ip.family === "v4" ? 32 : 128;
    let prefixLength = maxPrefix;
    if (slashIndex >= 0) {
      const prefixText = entry.slice(slashIndex + 1);
      if (!/^\d{1,3}$/.test(prefixText)) {
        throw new Error(`Invalid trusted proxy CIDR prefix: ${entry}`);
      }
      prefixLength = Number.parseInt(prefixText, 10);
      if (prefixLength > maxPrefix) {
        throw new Error(`Invalid trusted proxy CIDR prefix: ${entry}`);
      }
    }
    networks.push({ ip, prefixLength });
  }
  return {
    isEmpty: networks.length === 0,
    isTrusted: (ip) => networks.some((network) => matchesNetwork(ip, network)),
  };
}

/** The one forwarded header this application interprets. */
export const FORWARDED_FOR_HEADER = "x-forwarded-for";

export interface ClientIpInput {
  /** The direct TCP peer as reported by the listener. */
  readonly socketIp: string;
  /** Raw `X-Forwarded-For` header value, or null when absent. */
  readonly forwardedFor: string | null;
}

/**
 * Resolves the effective client IP under the trust model documented above. Always
 * returns a non-empty string; on any doubt it returns the (canonicalized) socket IP.
 */
export function resolveClientIp(input: ClientIpInput, matcher: TrustedProxyMatcher): string {
  const socketParsed = parseIpAddress(input.socketIp);
  const socketIp = socketParsed ? formatIpAddress(socketParsed) : input.socketIp;

  if (matcher.isEmpty || !socketParsed || !matcher.isTrusted(socketParsed)) {
    return socketIp;
  }
  const raw = input.forwardedFor?.trim();
  if (!raw) return socketIp;

  const entries = raw.split(",");
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = (entries[i] ?? "").trim();
    if (entry === "") return socketIp; // empty chain element — refuse the whole chain
    const normalizedEntry = stripPortAndBrackets(entry);
    if (normalizedEntry === null) return socketIp;
    const parsed = parseIpAddress(normalizedEntry);
    if (!parsed) return socketIp; // malformed element — refuse the whole chain
    if (matcher.isTrusted(parsed)) continue; // one of our own proxies; keep walking left
    return formatIpAddress(parsed);
  }
  return socketIp; // every hop trusted: the request originated inside our own infra
}

/** Request-level convenience used by the HTTP transport (covers the WS upgrade too). */
export function resolveClientIpFromRequest(
  request: Request,
  socketIp: string,
  matcher: TrustedProxyMatcher,
): string {
  return resolveClientIp(
    { socketIp, forwardedFor: request.headers.get(FORWARDED_FOR_HEADER) },
    matcher,
  );
}
