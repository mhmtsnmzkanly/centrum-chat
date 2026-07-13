export function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for open")), 2000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
}

/** Races "open" against "error" instead of only waiting on "open", so a rejected
 * handshake (non-101 response) resolves the caller instead of hitting the timeout —
 * and clears the timer on whichever settles first so no timer leaks past the test. */
export function waitForOpenOrError(socket: WebSocket): Promise<"open" | "error"> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve("open");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for open/error")), 2000);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve("open");
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      resolve("error");
    }, { once: true });
  });
}

/**
 * Buffers every message a socket receives from the moment the queue is created, so
 * `next()` never races against messages that arrive before it's called. A naive
 * `addEventListener("message", ..., { once: true })` attached lazily at await-time
 * silently drops any message that arrives in the gap before it's attached — a real bug
 * this queue exists to avoid, not just a style preference.
 */
export class WsMessageQueue {
  private readonly pending: unknown[] = [];
  private readonly waiters: Array<(value: unknown) => void> = [];

  constructor(socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const parsed = JSON.parse(event.data as string);
      const waiter = this.waiters.shift();
      if (waiter) waiter(parsed);
      else this.pending.push(parsed);
    });
  }

  next(timeoutMs = 2000): Promise<unknown> {
    const queued = this.pending.shift();
    if (queued !== undefined) return Promise.resolve(queued);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("timed out waiting for a message")),
        timeoutMs,
      );
      this.waiters.push((value) => {
        clearTimeout(timeout);
        resolve(value);
      });
    });
  }
}

export function send(socket: WebSocket, id: string, event: string, data: unknown): void {
  socket.send(JSON.stringify({ id, event, data }));
}
