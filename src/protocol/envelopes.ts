import type { ErrorPayload } from "../shared/errors/errorPayload.ts";

/** client -> server */
export interface InboundEnvelope {
  readonly id: string;
  readonly event: string;
  readonly data: unknown;
}

/** server -> client, response to a request (correlated by echoing `id`) */
export interface OutboundResponse {
  readonly id: string;
  readonly event: string;
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: ErrorPayload;
}

/** server -> client, unsolicited push (no `id`) */
export interface OutboundPush {
  readonly event: string;
  readonly data: unknown;
}

export function isInboundEnvelope(value: unknown): value is InboundEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.event === "string" &&
    "data" in candidate;
}

/** Unsolicited protocol-level error: used when a message can't even be parsed into an
 * InboundEnvelope, so there is no request `id` to correlate a normal OutboundResponse
 * against (e.g. malformed JSON, or valid JSON that isn't {id, event, data}). */
export function protocolErrorPush(error: ErrorPayload): OutboundPush {
  return { event: "protocol.error", data: error };
}

/** General-purpose unsolicited push, e.g. `presence.updated`, `message.new`. */
export function outboundPush(event: string, data: unknown): OutboundPush {
  return { event, data };
}
