import { assertEquals } from "jsr:@std/assert@1";
import { ConnectionManager } from "../../src/transport/websocket/connectionManager.ts";

function fakeSocket(
  options: {
    readyState?: number;
    bufferedAmount?: number;
    throwOnSend?: boolean;
  } = {},
) {
  const sent: Array<string | Uint8Array> = [];
  const closeCalls: Array<{ code: number; reason: string }> = [];
  let bufferedAmount = options.bufferedAmount ?? 0;
  const socket = {
    readyState: options.readyState ?? 1,
    get bufferedAmount() {
      return bufferedAmount;
    },
    set bufferedAmount(value: number) {
      bufferedAmount = value;
    },
    send(data: string | Uint8Array) {
      if (options.throwOnSend) throw new Error("boom");
      sent.push(data);
    },
    close(code: number, reason: string) {
      closeCalls.push({ code, reason });
      this.readyState = 3;
    },
  };
  return {
    socket: socket as unknown as WebSocket,
    sent,
    closeCalls,
    setBufferedAmount(value: number) {
      bufferedAmount = value;
    },
  };
}

function reserveAndOpen(
  manager: ConnectionManager,
  input: { connectionId: string; userId: string; clientIp: string },
  socket = fakeSocket(),
) {
  const admission = manager.reserveConnection(input);
  assertEquals(admission.ok, true);
  manager.bindSocket(input.connectionId, socket.socket);
  manager.markOpen(input.connectionId);
  return socket;
}

Deno.test("ConnectionManager: reserve/open/close tracks counts and online status", () => {
  const manager = new ConnectionManager();
  assertEquals(manager.count(), 0);
  assertEquals(manager.isUserOnline("u-1"), false);

  reserveAndOpen(manager, { connectionId: "c-1", userId: "u-1", clientIp: "127.0.0.1" });
  assertEquals(manager.count(), 1);
  assertEquals(manager.countConnectionsForUser("u-1"), 1);
  assertEquals(manager.countConnectionsForIp("127.0.0.1"), 1);
  assertEquals(manager.isUserOnline("u-1"), true);
  assertEquals(manager.connectedUserIds(), ["u-1"]);

  manager.handleSocketClosed("c-1");
  assertEquals(manager.count(), 0);
  assertEquals(manager.countConnectionsForUser("u-1"), 0);
  assertEquals(manager.countConnectionsForIp("127.0.0.1"), 0);
  assertEquals(manager.isUserOnline("u-1"), false);
});

Deno.test("ConnectionManager: cleanup is idempotent across server-close then socket-close", () => {
  const manager = new ConnectionManager();
  const socket = reserveAndOpen(manager, {
    connectionId: "c-1",
    userId: "u-1",
    clientIp: "127.0.0.1",
  });

  manager.closeConnection("c-1", { code: 1008, reason: "Connection closed.", source: "server" });
  manager.handleSocketClosed("c-1");

  assertEquals(manager.count(), 0);
  assertEquals(manager.countConnectionsForUser("u-1"), 0);
  assertEquals(socket.closeCalls, [{ code: 1008, reason: "Connection closed." }]);
});

Deno.test("ConnectionManager: per-user limit rejects the next reservation and reconnect succeeds after cleanup", () => {
  const manager = new ConnectionManager({ maxConnectionsPerUser: 2, maxConnectionsPerIp: 10 });
  reserveAndOpen(manager, { connectionId: "c-1", userId: "u-1", clientIp: "127.0.0.1" });
  reserveAndOpen(manager, { connectionId: "c-2", userId: "u-1", clientIp: "127.0.0.1" });

  assertEquals(
    manager.reserveConnection({ connectionId: "c-3", userId: "u-1", clientIp: "127.0.0.1" }),
    { ok: false, reason: "USER_CONNECTION_LIMIT" },
  );

  manager.handleSocketClosed("c-1");
  assertEquals(
    manager.reserveConnection({ connectionId: "c-3", userId: "u-1", clientIp: "127.0.0.1" }),
    { ok: true, connectionId: "c-3" },
  );
});

Deno.test("ConnectionManager: per-IP limit rejects different users sharing the same peer IP", () => {
  const manager = new ConnectionManager({ maxConnectionsPerUser: 10, maxConnectionsPerIp: 2 });
  reserveAndOpen(manager, { connectionId: "c-1", userId: "u-1", clientIp: "127.0.0.1" });
  reserveAndOpen(manager, { connectionId: "c-2", userId: "u-2", clientIp: "127.0.0.1" });

  assertEquals(
    manager.reserveConnection({ connectionId: "c-3", userId: "u-3", clientIp: "127.0.0.1" }),
    { ok: false, reason: "IP_CONNECTION_LIMIT" },
  );
  assertEquals(
    manager.reserveConnection({ connectionId: "c-4", userId: "u-3", clientIp: "127.0.0.2" }),
    { ok: true, connectionId: "c-4" },
  );
});

Deno.test("ConnectionManager.broadcastToAll: only open connections receive the payload", () => {
  const manager = new ConnectionManager();
  const open = reserveAndOpen(manager, {
    connectionId: "c-1",
    userId: "u-1",
    clientIp: "127.0.0.1",
  });
  const reservedOnly = fakeSocket();

  const admission = manager.reserveConnection({
    connectionId: "c-2",
    userId: "u-2",
    clientIp: "127.0.0.2",
  });
  assertEquals(admission.ok, true);
  manager.bindSocket("c-2", reservedOnly.socket);

  manager.broadcastToAll("hello");

  assertEquals(open.sent, ["hello"]);
  assertEquals(reservedOnly.sent, []);
});

Deno.test("ConnectionManager.sendToConnection: slow client is closed before the payload is sent", () => {
  const manager = new ConnectionManager({ maxBufferedAmountBytes: 8 });
  const slow = reserveAndOpen(manager, {
    connectionId: "c-1",
    userId: "u-1",
    clientIp: "127.0.0.1",
  });
  slow.setBufferedAmount(9);

  assertEquals(manager.sendToConnection("c-1", "hello"), false);
  assertEquals(slow.sent, []);
  assertEquals(manager.count(), 0);
  assertEquals(slow.closeCalls, [{ code: 1008, reason: "Connection closed." }]);
});

Deno.test("ConnectionManager.broadcastToAll: one send failure closes only the failing connection and does not abort healthy fanout", () => {
  const manager = new ConnectionManager();
  const healthy = reserveAndOpen(manager, {
    connectionId: "c-1",
    userId: "u-1",
    clientIp: "127.0.0.1",
  });
  const broken = reserveAndOpen(
    manager,
    { connectionId: "c-2", userId: "u-2", clientIp: "127.0.0.2" },
    fakeSocket({ throwOnSend: true }),
  );

  manager.broadcastToAll("hello");

  assertEquals(healthy.sent, ["hello"]);
  assertEquals(broken.sent, []);
  assertEquals(broken.closeCalls, [{ code: 1011, reason: "Connection closed." }]);
  assertEquals(manager.countConnectionsForUser("u-1"), 1);
  assertEquals(manager.countConnectionsForUser("u-2"), 0);
});
