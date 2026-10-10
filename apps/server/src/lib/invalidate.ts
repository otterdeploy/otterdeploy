/**
 * Resource invalidation fan-out. Procedures receive `context.broadcast` and may
 * call it after a write; nothing delivers it to a client any more.
 *
 * It used to go out over `/ws`, a WebSocket that no client used and that did
 * not check the caller's session or organization. The route is gone and this
 * stays a no-op so the context shape is unchanged.
 */
export const invalidate = {
  broadcast(_resource: string): void {},
};
