/**
 * Shared HTTP plumbing for the external secret-manager clients.
 *
 * Every provider call funnels through `vaultFetch` so the rules hold in one
 * place: a hard 15s timeout (a hung Vault must not hang a deploy forever),
 * zod-parsed response bodies (never cast), and error messages that name the
 * provider + HTTP status without ever echoing the credential or a secret
 * value.
 */

import * as z from "zod";

const TIMEOUT_MS = 15_000;

export interface VaultFetchOptions<T> {
  /** Operator-facing provider name for error messages. */
  providerName: string;
  url: string;
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** JSON-serialized when present. Must never contain the raw credential in
   *  a form that could end up in an error message: errors only ever quote
   *  provider name + status, not bodies. */
  body?: unknown;
}

export async function vaultFetch<T>(opts: VaultFetchOptions<T>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(opts.url, {
      method: opts.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? `timed out after ${TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : String(err);
    throw new Error(`secret provider "${opts.providerName}": request failed (${reason})`);
  }

  if (!res.ok) {
    throw new Error(
      `secret provider "${opts.providerName}": HTTP ${res.status} from the provider API: ` +
        statusHint(res.status),
    );
  }

  const decoded: unknown = await res.json().catch(() => {
    throw new Error(`secret provider "${opts.providerName}": response was not valid JSON`);
  });
  const parsed = opts.schema.safeParse(decoded);
  if (!parsed.success) {
    // Shape mismatch, not a value dump: never include the body (it may hold
    // secret material): the zod issue paths are enough to debug.
    throw new Error(
      `secret provider "${opts.providerName}": unexpected response shape (${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.path.join(".") || "(root)")
        .join(", ")})`,
    );
  }
  return parsed.data;
}

/** Operator-actionable next step per common status class. */
function statusHint(status: number): string {
  if (status === 401 || status === 403) return "the stored credential was rejected";
  if (status === 404) return "the configured path/project was not found";
  if (status >= 500) return "the provider is unavailable";
  return "check the provider configuration";
}

/** Strip trailing slashes so `${base}/v1/...` concatenation stays clean. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
