import { outboundPush } from "../../protocol/envelopes.ts";
import type { ProtocolCodec } from "../../protocol/protocolCodec.ts";
import type { Logger } from "../../shared/logging/logger.ts";
import type {
  ConnectionManager,
  ManagedConnectionSnapshot,
} from "../../transport/websocket/connectionManager.ts";

type TimerHandle = ReturnType<typeof setTimeout> | number;

export interface LifecycleScheduler {
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancel(handle: TimerHandle): void;
}

const realScheduler: LifecycleScheduler = {
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle),
};

export interface WebSocketLifecycleJobOptions {
  readonly heartbeatIntervalMs: number;
  readonly idleTimeoutMs: number;
  readonly scheduler?: LifecycleScheduler;
  readonly now?: () => number;
}

/** One shared timer that owns WS heartbeat pushes and stale-connection cleanup. */
export class WebSocketLifecycleJob {
  private readonly scheduler: LifecycleScheduler;
  private readonly now: () => number;
  private readonly encodedPing: string | Uint8Array;
  private timerHandle: TimerHandle | null = null;
  private started = false;
  private stopped = false;
  private running = false;

  constructor(
    private readonly connectionManager: ConnectionManager,
    codec: ProtocolCodec,
    private readonly logger: Logger,
    private readonly options: WebSocketLifecycleJobOptions,
  ) {
    this.scheduler = options.scheduler ?? realScheduler;
    this.now = options.now ?? (() => Date.now());
    this.encodedPing = codec.encode(outboundPush("system.ping", {}));

    if (options.heartbeatIntervalMs <= 0) {
      throw new Error("WS_HEARTBEAT_INTERVAL_MS must be greater than zero.");
    }
    if (options.idleTimeoutMs <= options.heartbeatIntervalMs) {
      throw new Error("WS_IDLE_TIMEOUT_MS must be greater than WS_HEARTBEAT_INTERVAL_MS.");
    }
  }

  runOnce(): void {
    if (this.stopped || this.running) return;
    this.running = true;
    try {
      this.sweep(this.now());
    } catch (error) {
      this.logger.error("websocket lifecycle sweep failed", { error });
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timerHandle !== null) {
      this.scheduler.cancel(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private scheduleNext(): void {
    if (this.stopped || this.timerHandle !== null) return;
    this.timerHandle = this.scheduler.schedule(() => {
      this.timerHandle = null;
      this.runOnce();
      if (!this.stopped) this.scheduleNext();
    }, this.options.heartbeatIntervalMs);
  }

  private sweep(nowMs: number): void {
    for (const connection of this.connectionManager.listOpenConnections()) {
      try {
        this.processConnection(connection, nowMs);
      } catch (error) {
        this.logger.error("websocket lifecycle connection processing failed", {
          connectionId: connection.id,
          userId: connection.userId,
          clientIp: connection.clientIp,
          error,
        });
      }
    }
  }

  private processConnection(connection: ManagedConnectionSnapshot, nowMs: number): void {
    const idleMs = nowMs - connection.lastActivityAt;
    if (idleMs >= this.options.idleTimeoutMs) {
      this.logger.warn("closing stale websocket connection", {
        connectionId: connection.id,
        userId: connection.userId,
        clientIp: connection.clientIp,
        idleMs,
      });
      this.connectionManager.closeConnection(connection.id, {
        code: 1001,
        reason: "Connection closed.",
        source: "stale",
      });
      return;
    }

    if (idleMs < this.options.heartbeatIntervalMs) return;

    const lastHeartbeatSentAt = connection.lastHeartbeatSentAt;
    const heartbeatAlreadyPending = lastHeartbeatSentAt !== null &&
      lastHeartbeatSentAt >= connection.lastActivityAt &&
      nowMs - lastHeartbeatSentAt < this.options.heartbeatIntervalMs;
    if (heartbeatAlreadyPending) return;

    if (this.connectionManager.sendToConnection(connection.id, this.encodedPing)) {
      this.connectionManager.recordHeartbeatSent(connection.id, nowMs);
    }
  }
}
