import { parseCapacityHarnessConfig } from "./capacityHarnessConfig.ts";

const { target, clients, token, smoke } = parseCapacityHarnessConfig(Deno.args);

if (smoke) {
  console.log(JSON.stringify({
    mode: "config-smoke",
    networkExecuted: false,
    target: target.origin,
    clients,
    remoteGuard: true,
    scenarios: ["argument-validation", "remote-target-guard"],
  }));
  Deno.exit(0);
}

if (!token) {
  throw new Error("--token is required for a live run; use a dedicated local test account.");
}

const latencies: number[] = [];
let connected = 0;
let failed = 0;
let disconnects = 0;
let pongs = 0;
const sockets: WebSocket[] = [];
await Promise.all(Array.from({ length: clients }, (_, index) =>
  new Promise<void>((resolve) => {
    const started = performance.now();
    const socket = new WebSocket(`${target}?token=${encodeURIComponent(token)}`);
    sockets.push(socket);
    socket.onopen = () => {
      connected++;
      latencies.push(performance.now() - started);
      resolve();
    };
    socket.onerror = () => {
      failed++;
      resolve();
    };
    socket.onclose = () => {
      disconnects++;
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.event === "system.ping") {
        socket.send(JSON.stringify({ id: `load-pong-${index}`, event: "system.pong", data: {} }));
        pongs++;
      }
    };
  })));
for (const socket of sockets) socket.close();
latencies.sort((a, b) => a - b);
const percentile = (p: number) =>
  latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] ?? null;
console.log(JSON.stringify({
  target: target.origin,
  clientsRequested: clients,
  successfulConnections: connected,
  failedConnections: failed,
  disconnects,
  pingPongResponses: pongs,
  errorRate: clients ? failed / clients : 0,
  connectLatencyMs: { p50: percentile(0.5), p95: percentile(0.95), p99: percentile(0.99) },
  note:
    "This connection/idle scenario intentionally does not send messages or attachments. Run against a dedicated local test environment.",
}));
