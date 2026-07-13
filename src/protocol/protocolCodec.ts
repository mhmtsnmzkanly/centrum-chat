/**
 * Abstraction over wire-format encode/decode. JsonCodec is the only implementation
 * exercised in protocol v1.0; a future EnfCodec (v2.0) implements the same interface
 * against a binary format. No module outside src/protocol/** may call
 * JSON.parse/JSON.stringify directly — every place that needs to turn a message into
 * bytes/text or back goes through a ProtocolCodec instance, so swapping v2.0's wire
 * format is a one-file change here, not a change to application/domain code.
 */
export interface ProtocolCodec {
  decode<T = unknown>(raw: string | Uint8Array): T;
  encode(message: unknown): string;
}
