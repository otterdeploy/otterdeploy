/**
 * Host canonicalization for edge-log scoping.
 *
 * Caddy's access log records `request.host` verbatim from the client's Host
 * header — which may differ in CASE (`Example.com`) or carry a PORT suffix
 * (`example.com:8443`) from the domain string we store on `proxy_route`. The
 * visibility filter matches a log row's host against the caller's owned domains
 * by exact string, so any such difference silently drops a captured request
 * from every query and tail. Canonicalizing both sides — stored host at ingest,
 * owned domains at scope resolution — makes the match hold. Caddy already routes
 * host-insensitively to case/port, so the log view matching the same way is the
 * correct, not a lax, behavior.
 */

/** Lowercase and strip a trailing `:port`. Edge hosts are DNS names (and the
 *  occasional IPv6 literal like `[::1]`); the `[.*]` guard keeps a bracketed
 *  IPv6 literal intact while still stripping its port. Idempotent. */
export function normalizeHost(host: string): string {
  const lower = host.trim().toLowerCase();
  // `[::1]:443` -> `[::1]`, `example.com:8443` -> `example.com`, bare host as-is.
  const m = lower.match(/^(\[[^\]]+\]|[^:]+):\d+$/);
  return m?.[1] ?? lower;
}
