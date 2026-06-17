/**
 * Bun's `fetch` bundles its own CA list and does NOT consult the macOS keychain
 * (or other system trust stores), so it rejects the locally-trusted certificate
 * the dev portless proxy serves on `*.localhost:1355` — even though curl and the
 * browser, which use the system store, accept it. The symptom is a bare
 * "Unable to connect" from better-fetch with no further detail.
 *
 * For LOCAL dev hosts only, hand back a fetch that skips TLS verification.
 * Every other host (staging, prod) keeps full verification — the relaxation is
 * scoped strictly to loopback / `.localhost` so it can never weaken a real
 * connection.
 */

function isLocalHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

/**
 * A `fetch` for the given base URL: the stock global fetch for remote hosts, or
 * a TLS-relaxed wrapper for local dev hosts. Usable as both oRPC's `RPCLink`
 * fetch and better-auth's `customFetchImpl` (it accepts the standard
 * `(input, init)` and ignores any extra positional args those callers pass).
 */
export function fetchFor(baseUrl: string): typeof fetch {
  if (!isLocalHost(baseUrl)) return fetch;
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    fetch(input, {
      ...init,
      // `tls` is a Bun-specific fetch option, absent from the standard
      // RequestInit type — accepting the self-signed local cert the portless
      // proxy serves.
      tls: { rejectUnauthorized: false },
    } as RequestInit)) as typeof fetch;
}
