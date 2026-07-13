import { ValidationError } from "../../../../shared/errors/validationError.ts";

const COLLAPSE_WHITESPACE = /\s+/g;

export function sanitizeUploadFileName(fileName: string): string {
  const baseName = fileName.split(/[/\\]/).pop()?.trim() ?? "";
  const sanitized = baseName
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      if (char === '"' || code <= 0x1f || code === 0x7f) return "_";
      return char;
    })
    .join("")
    .replace(COLLAPSE_WHITESPACE, " ")
    .slice(0, 255)
    .trim();
  return sanitized.length > 0 ? sanitized : "upload";
}

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  if (bytes.length < prefix.length) return false;
  return prefix.every((value, index) => bytes[index] === value);
}

function sniffImageMimeType(bytes: Uint8Array): string | null {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Avatar/cover uploads must be real raster images, not just a claimed MIME type. */
export function requireSupportedImageMimeType(bytes: Uint8Array): string {
  const detected = sniffImageMimeType(bytes);
  if (!detected) {
    throw new ValidationError(
      '"file" must be a PNG, JPEG, GIF, or WebP image with a valid file signature.',
      { field: "file" },
    );
  }
  return detected;
}
