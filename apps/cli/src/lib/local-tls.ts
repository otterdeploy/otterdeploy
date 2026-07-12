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

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

/**
 * A `fetch` for the given base URL: the stock global fetch for remote hosts, or
 * — in dev only — a TLS-relaxed wrapper for the loopback portless proxy
 * (self-signed cert on `*.localhost:1355`). Usable as both oRPC's `RPCLink`
 * fetch and better-auth's `customFetchImpl`.
 *
 * The dev relaxation is Bun-only and localhost-only. The publish build passes
 * `--define process.env.OTTERDEPLOY_BUNDLED="1"`, so the leading term below
 * folds to `"1" !== "1"` → `false` and the whole branch (the only place
 * `rejectUnauthorized` appears) is dead-code-eliminated — the shipped CLI
 * contains no certificate-verification bypass at all. Running from source
 * (`bun run start`) leaves the env var unset, keeping the relaxation for dev.
 */
export function fetchFor(baseUrl: string): typeof fetch {
  if (
    // oxlint-disable-next-line node/no-process-env -- build-time define, folded to false in the published bundle
    process.env.OTTERDEPLOY_BUNDLED !== "1" &&
    isBun &&
    isLocalHost(baseUrl)
  ) {
    return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      fetch(input, {
        ...init,
        // `tls` is a Bun-specific fetch option (absent from RequestInit).
        tls: { rejectUnauthorized: false },
      } as RequestInit)) as typeof fetch;
  }
  return fetch;
}
