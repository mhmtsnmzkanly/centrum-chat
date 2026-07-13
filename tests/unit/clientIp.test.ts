import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  createTrustedProxyMatcher,
  FORWARDED_FOR_HEADER,
  resolveClientIp,
  resolveClientIpFromRequest,
} from "../../src/shared/security/clientIp.ts";

const NO_TRUST = createTrustedProxyMatcher([]);
const LOOPBACK = createTrustedProxyMatcher(["127.0.0.1", "::1"]);

Deno.test("untrusted peer with a spoofed X-Forwarded-For keeps the socket IP", () => {
  assertEquals(
    resolveClientIp(
      { socketIp: "203.0.113.9", forwardedFor: "10.0.0.1" },
      LOOPBACK,
    ),
    "203.0.113.9",
  );
  assertEquals(
    resolveClientIp(
      { socketIp: "127.0.0.1", forwardedFor: "1.2.3.4" },
      NO_TRUST,
    ),
    "127.0.0.1",
  );
});

Deno.test("spoofed CF-Connecting-IP / X-Real-IP headers are never consulted", () => {
  const request = new Request("http://localhost/", {
    headers: {
      "cf-connecting-ip": "6.6.6.6",
      "x-real-ip": "7.7.7.7",
    },
  });
  // Even from a trusted peer, only X-Forwarded-For carries IP authority.
  assertEquals(resolveClientIpFromRequest(request, "127.0.0.1", LOOPBACK), "127.0.0.1");

  const withForwarded = new Request("http://localhost/", {
    headers: {
      "cf-connecting-ip": "6.6.6.6",
      [FORWARDED_FOR_HEADER]: "198.51.100.7",
    },
  });
  assertEquals(resolveClientIpFromRequest(withForwarded, "127.0.0.1", LOOPBACK), "198.51.100.7");
});

Deno.test("trusted loopback proxy with a valid forwarded IP yields the real client IP", () => {
  assertEquals(
    resolveClientIp(
      { socketIp: "127.0.0.1", forwardedFor: "198.51.100.7" },
      LOOPBACK,
    ),
    "198.51.100.7",
  );
});

Deno.test("trusted proxy with a valid IPv6 client yields the IPv6 address", () => {
  assertEquals(
    resolveClientIp(
      { socketIp: "::1", forwardedFor: "2001:db8:0:0:0:0:0:1" },
      LOOPBACK,
    ),
    "2001:db8::1",
  );
  // Bracketed-with-port form (RFC 7239-style producers) is stripped safely.
  assertEquals(
    resolveClientIp(
      { socketIp: "127.0.0.1", forwardedFor: "[2001:db8::2]:51334" },
      LOOPBACK,
    ),
    "2001:db8::2",
  );
});

Deno.test("IPv6 textual variants of one client collapse into one canonical bucket key", () => {
  const spellings = [
    "2001:DB8::1",
    "2001:db8:0:0:0:0:0:1",
    "2001:0db8:0000:0000:0000:0000:0000:0001",
  ];
  for (const spelling of spellings) {
    assertEquals(
      resolveClientIp({ socketIp: "127.0.0.1", forwardedFor: spelling }, LOOPBACK),
      "2001:db8::1",
    );
  }
});

Deno.test("IPv4-mapped IPv6 normalizes to dotted IPv4 for both trust and output", () => {
  assertEquals(
    resolveClientIp(
      { socketIp: "::ffff:127.0.0.1", forwardedFor: "198.51.100.7" },
      LOOPBACK,
    ),
    "198.51.100.7",
  );
  assertEquals(
    resolveClientIp(
      { socketIp: "127.0.0.1", forwardedFor: "::ffff:198.51.100.7" },
      LOOPBACK,
    ),
    "198.51.100.7",
  );
});

Deno.test("malformed forwarded entries fall back safely to the socket IP", () => {
  const malformed = [
    "not-an-ip",
    "999.1.1.1",
    "203.0.113.5, <script>",
    "2001:db8::1::2",
    "203.0.113.5, , 127.0.0.1",
    "01.2.3.4",
    "fe80::1%eth0",
    "[2001:db8::1]garbage",
    "[2001:db8::1]:99999",
    "198.51.100.7:99999",
  ];
  for (const header of malformed) {
    assertEquals(
      resolveClientIp({ socketIp: "127.0.0.1", forwardedFor: header }, LOOPBACK),
      "127.0.0.1",
      `header should be refused: ${header}`,
    );
  }
});

Deno.test("empty or missing X-Forwarded-For keeps the socket IP", () => {
  assertEquals(
    resolveClientIp({ socketIp: "127.0.0.1", forwardedFor: null }, LOOPBACK),
    "127.0.0.1",
  );
  assertEquals(
    resolveClientIp({ socketIp: "127.0.0.1", forwardedFor: "" }, LOOPBACK),
    "127.0.0.1",
  );
  assertEquals(
    resolveClientIp({ socketIp: "127.0.0.1", forwardedFor: "   " }, LOOPBACK),
    "127.0.0.1",
  );
});

Deno.test("multi-hop chains resolve right-to-left: nearest untrusted entry wins", () => {
  const cloudflareAndLoopback = createTrustedProxyMatcher(["127.0.0.1", "198.51.100.0/24"]);
  // Client appended garbage on the left; Cloudflare (trusted /24) appended the real
  // client; Caddy (loopback) appended Cloudflare's edge address.
  assertEquals(
    resolveClientIp(
      {
        socketIp: "127.0.0.1",
        forwardedFor: "6.6.6.6, 203.0.113.77, 198.51.100.30",
      },
      cloudflareAndLoopback,
    ),
    "203.0.113.77",
  );
  // Without the Cloudflare range trusted, the edge address itself is the client.
  assertEquals(
    resolveClientIp(
      {
        socketIp: "127.0.0.1",
        forwardedFor: "6.6.6.6, 203.0.113.77, 198.51.100.30",
      },
      LOOPBACK,
    ),
    "198.51.100.30",
  );
});

Deno.test("a chain consisting solely of trusted proxies keeps the socket IP", () => {
  assertEquals(
    resolveClientIp(
      { socketIp: "127.0.0.1", forwardedFor: "127.0.0.1, ::1" },
      LOOPBACK,
    ),
    "127.0.0.1",
  );
});

Deno.test("IPv4 with port in a forwarded entry is stripped; bare IPv6 is not port-stripped", () => {
  assertEquals(
    resolveClientIp(
      { socketIp: "127.0.0.1", forwardedFor: "198.51.100.7:58012" },
      LOOPBACK,
    ),
    "198.51.100.7",
  );
  // "2001:db8::7" must not lose ":7" to port stripping.
  assertEquals(
    resolveClientIp(
      { socketIp: "127.0.0.1", forwardedFor: "2001:db8::7" },
      LOOPBACK,
    ),
    "2001:db8::7",
  );
});

Deno.test("CIDR trust matching covers IPv4 and IPv6 blocks", () => {
  const matcher = createTrustedProxyMatcher(["10.0.0.0/8", "2400:cb00::/32"]);
  assertEquals(
    resolveClientIp({ socketIp: "10.20.30.40", forwardedFor: "203.0.113.5" }, matcher),
    "203.0.113.5",
  );
  assertEquals(
    resolveClientIp({ socketIp: "2400:cb00:1:2::3", forwardedFor: "203.0.113.5" }, matcher),
    "203.0.113.5",
  );
  assertEquals(
    resolveClientIp({ socketIp: "11.0.0.1", forwardedFor: "203.0.113.5" }, matcher),
    "11.0.0.1",
  );
});

Deno.test("malformed trusted-proxy configuration entries fail fast", () => {
  assertThrows(() => createTrustedProxyMatcher(["not-an-ip"]));
  assertThrows(() => createTrustedProxyMatcher(["10.0.0.0/33"]));
  assertThrows(() => createTrustedProxyMatcher(["2001:db8::/129"]));
  assertThrows(() => createTrustedProxyMatcher(["10.0.0.0/abc"]));
});

Deno.test("with no trusted proxies configured behavior is identical to the socket peer", () => {
  const request = new Request("http://localhost/", {
    headers: { [FORWARDED_FOR_HEADER]: "1.2.3.4" },
  });
  assertEquals(resolveClientIpFromRequest(request, "127.0.0.1", NO_TRUST), "127.0.0.1");
});
