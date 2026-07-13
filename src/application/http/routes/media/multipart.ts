import { ValidationError } from "../../../../shared/errors/validationError.ts";
import { sanitizeUploadFileName } from "./uploadValidation.ts";

export interface ExtractedFile {
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

/** Pulls the single `file` field out of a `multipart/form-data` body (docs/04-http-api.md
 * "Media Upload"). Rejects fast on an over-large `Content-Length` before buffering the
 * body; still re-checks the decoded size afterward since `Content-Length` can be absent
 * or wrong under chunked transfer encoding. */
export async function extractSingleFile(
  request: Request,
  maxSizeBytes: number,
): Promise<ExtractedFile> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxSizeBytes) {
    throw new ValidationError(`"file" exceeds the maximum allowed size of ${maxSizeBytes} bytes.`);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ValidationError('Request must be multipart/form-data with a "file" field.');
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError('"file" is required.', { field: "file" });
  }
  if (file.size === 0) {
    throw new ValidationError('"file" must not be empty.', { field: "file" });
  }
  if (file.size > maxSizeBytes) {
    throw new ValidationError(`"file" exceeds the maximum allowed size of ${maxSizeBytes} bytes.`, {
      field: "file",
    });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    fileName: sanitizeUploadFileName(file.name),
    mimeType: file.type.length > 0 ? file.type : "application/octet-stream",
    bytes,
  };
}
