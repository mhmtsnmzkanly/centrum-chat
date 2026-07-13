import type { ProtocolCodec } from "./protocolCodec.ts";

/** JSON implementation of ProtocolCodec (protocol v1.0). This is the only file in the
 * codebase allowed to call JSON.parse/JSON.stringify. */
export class JsonCodec implements ProtocolCodec {
  decode<T = unknown>(raw: string | Uint8Array): T {
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
    return JSON.parse(text) as T;
  }

  encode(message: unknown): string {
    return JSON.stringify(message);
  }
}
