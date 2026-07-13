/** Generates a UUIDv4, used both as a primary key when constructing a new row and as a
 * general-purpose unique id (e.g. WS connection ids in transport/websocket/connection.ts). */
export function generateId(): string {
  return crypto.randomUUID();
}
