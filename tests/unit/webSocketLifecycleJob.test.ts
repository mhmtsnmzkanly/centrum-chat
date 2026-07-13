import { assertEquals } from "jsr:@std/assert@1";
import { WebSocketLifecycleJob } from "../../src/application/lifecycle/webSocketLifecycleJob.ts";
import { JsonCodec } from "../../src/protocol/jsonCodec.ts";
import { createLogger } from "../../src/shared/logging/logger.ts";
import { ConnectionManager } from "../../src/transport/websocket/connectionManager.ts";

class FakeScheduler {
  nextHandle = 1;
  pending = new Map<number, () => void>();

  schedule(callback: () => void, _delayMs: number): number {
    const handle = this.nextHandle++;
    this.pending.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.pending.delete(handle);
  }

  pendingCount(): number {
    return this.pending.size;
  }
}

function fakeSocket() {
  const sent: Array<string | Uint8Array> = [];
  const closeCalls: Array<{ code: number; reason: string }> = [];
  const socket = {
    readyState: 1,
    bufferedAmount: 0,
    send(data: string | Uint8Array) {
      sent.push(data);
    },
    close(code: number, reason: string) {
      closeCalls.push({ code, reason });
      this.readyState = 3;
    },
  };
  return { socket: socket as unknown as WebSocket, sent, closeCalls };
}

function reserveAndOpen(
  manager: ConnectionManager,
  connectionId: string,
  userId: string,
  clientIp: string,
) {
  const socket = fakeSocket();
  const admission = manager.reserveConnection({ connectionId, userId, clientIp });
  assertEquals(admission.ok, true);
  manager.bindSocket(connectionId, socket.socket);
  manager.markOpen(connectionId);
  return socket;
}

Deno.test("WebSocketLifecycleJob.start schedules once and stop cancels future runs", () => {
  const scheduler = new FakeScheduler();
  const manager = new ConnectionManager();
  const job = new WebSocketLifecycleJob(
    manager,
    new JsonCodec(),
    createLogger("error", "test-ws-lifecycle"),
    {
      heartbeatIntervalMs: 30_000,
      idleTimeoutMs: 90_000,
      scheduler,
    },
  );

  job.start();
  job.start();
  assertEquals(scheduler.pendingCount(), 1);

  job.stop();
  assertEquals(scheduler.pendingCount(), 0);
});

Deno.test("WebSocketLifecycleJob.runOnce sends one application heartbeat to an idle connection", () => {
  let nowMs = 0;
  const manager = new ConnectionManager({ now: () => nowMs });
  const socket = reserveAndOpen(manager, "c-1", "u-1", "127.0.0.1");
  const job = new WebSocketLifecycleJob(
    manager,
    new JsonCodec(),
    createLogger("error", "test-ws-lifecycle"),
    {
      heartbeatIntervalMs: 30_000,
      idleTimeoutMs: 90_000,
      now: () => nowMs,
    },
  );

  nowMs = 31_000;
  job.runOnce();
  assertEquals(socket.sent.length, 1);
  assertEquals(String(socket.sent[0]).includes("system.ping"), true);

  job.runOnce();
  assertEquals(socket.sent.length, 1);
});

Deno.test("WebSocketLifecycleJob.runOnce closes stale connections and leaves active ones alone", () => {
  let nowMs = 0;
  const manager = new ConnectionManager({ now: () => nowMs });
  const stale = reserveAndOpen(manager, "c-1", "u-1", "127.0.0.1");
  const healthy = reserveAndOpen(manager, "c-2", "u-2", "127.0.0.2");
  const job = new WebSocketLifecycleJob(
    manager,
    new JsonCodec(),
    createLogger("error", "test-ws-lifecycle"),
    {
      heartbeatIntervalMs: 30_000,
      idleTimeoutMs: 90_000,
      now: () => nowMs,
    },
  );

  nowMs = 40_000;
  manager.recordActivity("c-2", nowMs);
  nowMs = 95_000;
  job.runOnce();

  assertEquals(stale.closeCalls, [{ code: 1001, reason: "Connection closed." }]);
  assertEquals(healthy.closeCalls.length, 0);
  assertEquals(manager.countConnectionsForUser("u-1"), 0);
  assertEquals(manager.countConnectionsForUser("u-2"), 1);
});
