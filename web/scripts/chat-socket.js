import { store } from "./chat-store.js";
import { TOKENS, ensureFreshAccessToken, clearAuthenticatedState } from "./chat-auth.js";
import { handleSecurityErrorCode, makeClientError, ToastService } from "./chat-api.js";

// WebSocket Client: request/response RPC keyed by envelope id + push dispatcher
export class WebSocketClient {
  constructor() {
    this.socket = null;
    this.pendingRequests = new Map();
    this.listeners = new Map();
    this.requestIdCounter = 0;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.readyPromise = null;
    this.hadConnection = false;
    this.onReconnect = null;
  }

  async connect() {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)
    ) {
      return this.socket.readyState === WebSocket.OPEN ? Promise.resolve() : this.readyPromise;
    }

    if (this.isConnecting && this.readyPromise) return this.readyPromise;

    this.isConnecting = true;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const readyPromise = this.readyPromise;
    // Timer-driven retries don't await connect(); avoid unhandled rejections.
    readyPromise.catch(() => {});

    const accessToken = await ensureFreshAccessToken();

    // disconnect() may have run while the refresh was in flight.
    if (this.readyPromise !== readyPromise) return readyPromise;

    if (!accessToken) {
      this.failConnect(new Error("Authentication is required for WebSocket requests."));
      // A stored token that can no longer be refreshed means the session was
      // revoked/expired server-side — stop retrying and go back to sign-in.
      if (TOKENS.get()) {
        clearAuthenticatedState("Session expired. Please log in again.", "warning");
      }
      return readyPromise;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${
      encodeURIComponent(accessToken)
    }`;

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      const isReconnect = this.hadConnection;
      this.hadConnection = true;
      this.resolveReady?.();
      this.resolveReady = null;
      this.rejectReady = null;
      if (isReconnect && this.onReconnect) this.onReconnect();
    };

    this.socket.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        if (envelope.id) {
          const pending = this.pendingRequests.get(envelope.id);
          if (pending) {
            this.pendingRequests.delete(envelope.id);
            if (envelope.success) {
              pending.resolve(envelope.data);
            } else {
              const errMsg = envelope.error?.message || "Request failed.";
              handleSecurityErrorCode(envelope.error?.code);
              ToastService.show(errMsg, "error");
              pending.reject(makeClientError(envelope.error?.code, errMsg));
            }
          }
        } else {
          this.dispatchEvent(envelope.event, envelope.data);
        }
      } catch (err) {
        console.error("Error processing WebSocket message:", err);
      }
    };

    this.socket.onclose = () => {
      this.isConnecting = false;
      this.rejectReady?.(new Error("WebSocket connection closed."));
      this.resolveReady = null;
      this.rejectReady = null;
      this.rejectAllPendingRequests(new Error("WebSocket connection closed."));
      this.scheduleReconnect();
    };

    this.socket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    return readyPromise;
  }

  failConnect(error) {
    this.isConnecting = false;
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (!TOKENS.get()?.accessToken) return;
    const backoffMs = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    const delayMs = backoffMs * (0.5 + Math.random() * 0.5);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delayMs);
  }

  reconnectNow() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (!TOKENS.get()?.accessToken) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.connect().catch(() => {});
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.hadConnection = false;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.onclose = null;
      socket.close();
    }
    this.rejectReady?.(new Error("Disconnected."));
    this.resolveReady = null;
    this.rejectReady = null;
    this.readyPromise = null;
    this.rejectAllPendingRequests(new Error("Disconnected."));
  }

  rejectAllPendingRequests(error) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  sendFireAndForget(event, data = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    this.socket.send(JSON.stringify({ id: `sys-${++this.requestIdCounter}`, event, data }));
    return true;
  }

  async request(event, data = {}) {
    await this.connect();
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket is not connected."));
        return;
      }
      const requestId = `c-${++this.requestIdCounter}`;
      const payload = { id: requestId, event, data };

      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request ${event} timed out.`));
        }
      }, 15000);

      this.pendingRequests.set(requestId, {
        resolve: (res) => {
          clearTimeout(timeout);
          resolve(res);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.socket.send(JSON.stringify(payload));
    });
  }

  addEventListener(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  dispatchEvent(event, data) {
    const list = this.listeners.get(event);
    if (list) {
      for (const cb of list) {
        try {
          cb(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      }
    }
  }
}

export const wsClient = new WebSocketClient();

wsClient.addEventListener("system.ping", () => {
  wsClient.sendFireAndForget("system.pong", {});
});

window.addEventListener("online", () => {
  if (store.get("session.loggedIn")) wsClient.reconnectNow();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && store.get("session.loggedIn")) wsClient.reconnectNow();
});
