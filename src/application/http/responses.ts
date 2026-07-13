import type { ProtocolCodec } from "../../protocol/protocolCodec.ts";
import type { ErrorPayload } from "../../shared/errors/errorPayload.ts";
import { ValidationError } from "../../shared/errors/validationError.ts";

/** Decodes an HTTP request body, turning a malformed payload into a `VALIDATION_ERROR`
 * instead of letting `codec.decode`'s raw parse error escape to the error boundary as an
 * `INTERNAL_ERROR` (the WS transport already guards this same case in connection.ts —
 * HTTP routes need their own guard since they call `codec.decode` directly). */
export function decodeJsonBody(codec: ProtocolCodec, rawText: string): unknown {
  try {
    return codec.decode(rawText);
  } catch {
    throw new ValidationError("Malformed JSON request body.");
  }
}

function jsonResponse(codec: ProtocolCodec, body: unknown, status: number): Response {
  return new Response(codec.encode(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function successResponse(codec: ProtocolCodec, data: unknown, status = 200): Response {
  return jsonResponse(codec, { success: true, data }, status);
}

export function errorResponse(codec: ProtocolCodec, error: ErrorPayload, status: number): Response {
  return jsonResponse(codec, { success: false, error }, status);
}
