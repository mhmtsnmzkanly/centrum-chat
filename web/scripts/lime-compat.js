// Keep existing UI handlers on their pre-0.6.4 positional signature while
// mounting them through Lime's structured v0.6.4 event contract.
export function adaptLegacyHandlers(handlers) {
  const adapted = Object.create(null);
  for (const [name, handler] of Object.entries(handlers || {})) {
    if (typeof handler !== "function") continue;
    adapted[name] = (payload) => handler(
      payload?.event ?? null,
      payload?.element ?? null,
      payload?.data ?? null,
    );
  }
  return adapted;
}
