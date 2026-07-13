export function normalizeEmailIdentity(value: string): string {
  return value.trim();
}

export function sanitizeDeviceLabel(value: string | null): string | null {
  if (value === null) return null;
  const stripped = [...value].map((char) => {
    const code = char.charCodeAt(0);
    return (code <= 0x1f || code === 0x7f) ? " " : char;
  }).join("").trim();
  return stripped.length > 0 ? stripped : null;
}
