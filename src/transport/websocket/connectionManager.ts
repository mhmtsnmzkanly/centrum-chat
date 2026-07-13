import type { Logger } from "../../shared/logging/logger.ts";

export interface ManagedConnectionSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly clientIp: string;
  readonly socket: WebSocket | null;
  readonly createdAt: number;
  readonly openedAt: number | null;
  readonly lastActivityAt: number;
  readonly lastHeartbeatSentAt: number | null;
}

interface ManagedConnectionRecord extends ManagedConnectionSnapshot {
  socket: WebSocket | null;
  openedAt: number | null;
  lastActivityAt: number;
  lastHeartbeatSentAt: number | null;
}

export type ConnectionAdmissionRejectionReason = "USER_CONNECTION_LIMIT" | "IP_CONNECTION_LIMIT";

export type ConnectionAdmissionResult =
  | { readonly ok: true; readonly connectionId: string }
  | { readonly ok: false; readonly reason: ConnectionAdmissionRejectionReason };

export type ConnectionCloseSource =
  | "client"
  | "protocol_violation"
  | "payload_too_large"
  | "backpressure"
  | "send_error"
  | "stale"
  | "shutdown"
  | "upgrade_failed"
  | "server";

export interface ConnectionLifecycleHooks {
  onConnectionOpened?(
    connection: ManagedConnectionSnapshot,
    isFirstOpenConnectionForUser: boolean,
  ): void;
  onConnectionClosed?(
    connection: ManagedConnectionSnapshot,
    details: {
      readonly wasOpen: boolean;
      readonly isLastOpenConnectionForUser: boolean;
      readonly source: ConnectionCloseSource;
    },
  ): void;
}

export interface SocketOps {
  getReadyState(socket: WebSocket): number;
  getBufferedAmount(socket: WebSocket): number;
  send(socket: WebSocket, data: string | Uint8Array): void;
  close(socket: WebSocket, code: number, reason: string): void;
}

export interface ConnectionManagerOptions {
  readonly maxConnectionsPerUser?: number;
  readonly maxConnectionsPerIp?: number;
  readonly maxBufferedAmountBytes?: number;
  readonly now?: () => number;
  readonly logger?: Logger;
  readonly hooks?: ConnectionLifecycleHooks;
  readonly socketOps?: SocketOps;
}

const OPEN_READY_STATE = 1;

const defaultSocketOps: SocketOps = {
  getReadyState: (socket) => socket.readyState,
  getBufferedAmount: (socket) => socket.bufferedAmount,
  send: (socket, data) => socket.send(data),
  close: (socket, code, reason) => socket.close(code, reason),
};

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

function addIndexedId(index: Map<string, Set<string>>, key: string, connectionId: string): void {
  const ids = index.get(key) ?? new Set<string>();
  ids.add(connectionId);
  index.set(key, ids);
}

function removeIndexedId(index: Map<string, Set<string>>, key: string, connectionId: string): void {
  const ids = index.get(key);
  if (!ids) return;
  ids.delete(connectionId);
  if (ids.size === 0) index.delete(key);
}

/** Authoritative in-memory registry for authenticated WS connections. Owns admission
 * limits, connection/IP counters, outbound send policy, and idempotent cleanup. */
export class ConnectionManager {
  private readonly connectionsById = new Map<string, ManagedConnectionRecord>();
  private readonly connectionIdsByUserId = new Map<string, Set<string>>();
  private readonly openConnectionIdsByUserId = new Map<string, Set<string>>();
  private readonly connectionIdsByIp = new Map<string, Set<string>>();
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly hooks: ConnectionLifecycleHooks;
  private readonly socketOps: SocketOps;
  private readonly maxConnectionsPerUser: number;
  private readonly maxConnectionsPerIp: number;
  private readonly maxBufferedAmountBytes: number;

  constructor(options: ConnectionManagerOptions = {}) {
    this.maxConnectionsPerUser = options.maxConnectionsPerUser ?? 5;
    this.maxConnectionsPerIp = options.maxConnectionsPerIp ?? 25;
    this.maxBufferedAmountBytes = options.maxBufferedAmountBytes ?? 1_048_576;
    this.now = options.now ?? (() => Date.now());
    this.logger = options.logger ?? noopLogger;
    this.hooks = options.hooks ?? {};
    this.socketOps = options.socketOps ?? defaultSocketOps;
  }

  reserveConnection(input: {
    readonly connectionId: string;
    readonly userId: string;
    readonly clientIp: string;
  }): ConnectionAdmissionResult {
    if (this.countConnectionsForUser(input.userId) >= this.maxConnectionsPerUser) {
      return { ok: false, reason: "USER_CONNECTION_LIMIT" };
    }
    if (this.countConnectionsForIp(input.clientIp) >= this.maxConnectionsPerIp) {
      return { ok: false, reason: "IP_CONNECTION_LIMIT" };
    }

    const now = this.now();
    const connection: ManagedConnectionRecord = {
      id: input.connectionId,
      userId: input.userId,
      clientIp: input.clientIp,
      socket: null,
      createdAt: now,
      openedAt: null,
      lastActivityAt: now,
      lastHeartbeatSentAt: null,
    };
    this.connectionsById.set(input.connectionId, connection);
    addIndexedId(this.connectionIdsByUserId, input.userId, input.connectionId);
    addIndexedId(this.connectionIdsByIp, input.clientIp, input.connectionId);
    return { ok: true, connectionId: input.connectionId };
  }

  bindSocket(connectionId: string, socket: WebSocket): boolean {
    const connection = this.connectionsById.get(connectionId);
    if (!connection) return false;
    connection.socket = socket;
    return true;
  }

  releaseReservation(connectionId: string, source: ConnectionCloseSource = "upgrade_failed"): void {
    this.cleanupConnection(connectionId, source);
  }

  markOpen(connectionId: string): void {
    const connection = this.connectionsById.get(connectionId);
    if (!connection || connection.openedAt !== null) return;

    const isFirstOpenConnectionForUser = !this.isUserOnline(connection.userId);
    const now = this.now();
    connection.openedAt = now;
    connection.lastActivityAt = now;
    connection.lastHeartbeatSentAt = null;
    addIndexedId(this.openConnectionIdsByUserId, connection.userId, connection.id);

    const snapshot = this.snapshotConnection(connection);
    this.logger.info("websocket connected", {
      connectionId: snapshot.id,
      userId: snapshot.userId,
      clientIp: snapshot.clientIp,
    });
    this.hooks.onConnectionOpened?.(snapshot, isFirstOpenConnectionForUser);
  }

  handleSocketClosed(connectionId: string): void {
    this.cleanupConnection(connectionId, "client");
  }

  closeConnection(
    connectionId: string,
    options: {
      readonly code: number;
      readonly reason: string;
      readonly source: ConnectionCloseSource;
    },
  ): void {
    const connection = this.connectionsById.get(connectionId);
    if (!connection) return;
    const socket = connection.socket;
    this.cleanupConnection(connectionId, options.source);

    if (!socket) return;
    try {
      const readyState = this.socketOps.getReadyState(socket);
      if (readyState === 0 || readyState === 1) {
        this.socketOps.close(socket, options.code, options.reason);
      }
    } catch (error) {
      this.logger.warn("websocket close threw", {
        connectionId,
        userId: connection.userId,
        clientIp: connection.clientIp,
        source: options.source,
        error,
      });
    }
  }

  recordActivity(connectionId: string, at = this.now()): void {
    const connection = this.connectionsById.get(connectionId);
    if (!connection || connection.openedAt === null) return;
    connection.lastActivityAt = at;
    connection.lastHeartbeatSentAt = null;
  }

  recordHeartbeatSent(connectionId: string, at = this.now()): void {
    const connection = this.connectionsById.get(connectionId);
    if (!connection || connection.openedAt === null) return;
    connection.lastHeartbeatSentAt = at;
  }

  listOpenConnections(): ManagedConnectionSnapshot[] {
    return [...this.connectionsById.values()]
      .filter((connection) => connection.openedAt !== null)
      .map((connection) => this.snapshotConnection(connection));
  }

  count(): number {
    return this.connectionsById.size;
  }

  countConnectionsForUser(userId: string): number {
    return this.connectionIdsByUserId.get(userId)?.size ?? 0;
  }

  countConnectionsForIp(clientIp: string): number {
    return this.connectionIdsByIp.get(clientIp)?.size ?? 0;
  }

  isUserOnline(userId: string): boolean {
    return (this.openConnectionIdsByUserId.get(userId)?.size ?? 0) > 0;
  }

  connectedUserIds(): string[] {
    return [...this.openConnectionIdsByUserId.keys()];
  }

  sendToConnection(connectionId: string, encoded: string | Uint8Array): boolean {
    const connection = this.connectionsById.get(connectionId);
    if (!connection) return false;
    return this.trySend(connection, encoded);
  }

  broadcastToAll(encoded: string | Uint8Array): void {
    for (const connection of [...this.connectionsById.values()]) {
      this.trySend(connection, encoded);
    }
  }

  sendToUser(userId: string, encoded: string | Uint8Array): void {
    const ids = [...(this.openConnectionIdsByUserId.get(userId) ?? [])];
    for (const id of ids) {
      const connection = this.connectionsById.get(id);
      if (connection) this.trySend(connection, encoded);
    }
  }

  shutdownAllConnections(code = 1012, reason = "Server shutting down."): void {
    for (const connectionId of [...this.connectionsById.keys()]) {
      this.closeConnection(connectionId, { code, reason, source: "shutdown" });
    }
  }

  closeUserConnections(userId: string, code = 1008, reason = "Account policy changed."): void {
    const ids = [...(this.connectionIdsByUserId.get(userId) ?? [])];
    for (const connectionId of ids) {
      this.closeConnection(connectionId, { code, reason, source: "server" });
    }
  }

  private trySend(connection: ManagedConnectionRecord, encoded: string | Uint8Array): boolean {
    if (connection.socket === null || connection.openedAt === null) return false;
    if (this.socketOps.getReadyState(connection.socket) !== OPEN_READY_STATE) return false;

    const bufferedAmount = this.socketOps.getBufferedAmount(connection.socket);
    if (bufferedAmount > this.maxBufferedAmountBytes) {
      this.logger.warn("closing websocket slow client", {
        connectionId: connection.id,
        userId: connection.userId,
        clientIp: connection.clientIp,
        bufferedAmount,
        bufferedAmountLimit: this.maxBufferedAmountBytes,
      });
      this.closeConnection(connection.id, {
        code: 1008,
        reason: "Connection closed.",
        source: "backpressure",
      });
      return false;
    }

    try {
      this.socketOps.send(connection.socket, encoded);
      return true;
    } catch (error) {
      this.logger.warn("websocket send failed", {
        connectionId: connection.id,
        userId: connection.userId,
        clientIp: connection.clientIp,
        error,
      });
      this.closeConnection(connection.id, {
        code: 1011,
        reason: "Connection closed.",
        source: "send_error",
      });
      return false;
    }
  }

  private cleanupConnection(
    connectionId: string,
    source: ConnectionCloseSource,
  ): void {
    const connection = this.connectionsById.get(connectionId);
    if (!connection) return;

    const wasOpen = connection.openedAt !== null;
    this.connectionsById.delete(connectionId);
    removeIndexedId(this.connectionIdsByUserId, connection.userId, connection.id);
    removeIndexedId(this.connectionIdsByIp, connection.clientIp, connection.id);
    if (wasOpen) {
      removeIndexedId(this.openConnectionIdsByUserId, connection.userId, connection.id);
    }

    const snapshot = this.snapshotConnection(connection);
    const isLastOpenConnectionForUser = !this.isUserOnline(connection.userId);

    this.logger.info("websocket disconnected", {
      connectionId: snapshot.id,
      userId: snapshot.userId,
      clientIp: snapshot.clientIp,
      source,
    });
    this.hooks.onConnectionClosed?.(snapshot, {
      wasOpen,
      isLastOpenConnectionForUser,
      source,
    });
  }

  private snapshotConnection(connection: ManagedConnectionRecord): ManagedConnectionSnapshot {
    return {
      id: connection.id,
      userId: connection.userId,
      clientIp: connection.clientIp,
      socket: connection.socket,
      createdAt: connection.createdAt,
      openedAt: connection.openedAt,
      lastActivityAt: connection.lastActivityAt,
      lastHeartbeatSentAt: connection.lastHeartbeatSentAt,
    };
  }
}
