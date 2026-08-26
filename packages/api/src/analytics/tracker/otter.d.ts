/**
 * Types for the plain-JS tracker (otter.js). The function is never called on
 * the server: index.ts serializes its source text with Function#toString and
 * ships it to browsers, which is why the parameter is the (untyped) window.
 */
export function install(w: unknown): void;
