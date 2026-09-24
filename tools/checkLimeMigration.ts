const expectedSha256 = "c2865fd637708e4d4e5cb9a148bbf1c7d5e17b9ff86a4649c7a8e192ecffaeea";

async function sha256Hex(value: Uint8Array): Promise<string> {
  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const runtimePath = "web/scripts/lime-csr-0.6.4.js";
const runtime = await Deno.readFile(runtimePath);
const actualSha256 = await sha256Hex(runtime);
if (actualSha256 !== expectedSha256) {
  throw new Error(
    `${runtimePath} is not the verified lime-csr-js v0.6.4 distribution ` +
      `(expected ${expectedSha256}, got ${actualSha256})`,
  );
}

const sourceFiles = ["web/scripts/chat.js", "web/scripts/control-center.js"];
for (const path of sourceFiles) {
  const source = await Deno.readTextFile(path);
  if (/mount\s*\(\s*["']/.test(source)) {
    throw new Error(`${path} still uses the removed positional Lime mount signature`);
  }
  if (!source.includes('template: "') || !source.includes("adaptLegacyHandlers")) {
    throw new Error(`${path} is missing the v0.6.4 mount or handler compatibility contract`);
  }
}

console.log(`Verified lime-csr-js v0.6.4 browser distribution (${actualSha256})`);
