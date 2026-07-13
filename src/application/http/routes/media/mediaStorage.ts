function dirname(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash === -1 ? "." : path.slice(0, lastSlash);
}

/** Files live on disk under `MEDIA_ROOT` (config), addressed by a server-generated
 * relative path — never a client-supplied name — so there's no path-traversal surface
 * (docs/04-http-api.md "Media Upload"). */
export async function writeMediaFile(
  mediaRoot: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const fullPath = `${mediaRoot}/${relativePath}`;
  await Deno.mkdir(dirname(fullPath), { recursive: true });
  await Deno.writeFile(fullPath, bytes);
}

/** Best-effort delete — a file already missing on disk (desync, or a repeat cleanup
 * pass) is not an error. */
export async function deleteMediaFile(mediaRoot: string, relativePath: string): Promise<void> {
  try {
    await Deno.remove(`${mediaRoot}/${relativePath}`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
}

/** Opens a file for streaming (`GET /media/:id` never buffers the whole file into
 * memory); returns null if it's missing on disk. */
export async function openMediaFile(
  mediaRoot: string,
  relativePath: string,
): Promise<Deno.FsFile | null> {
  try {
    return await Deno.open(`${mediaRoot}/${relativePath}`, { read: true });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}
