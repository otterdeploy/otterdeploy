/**
 * Shared HTTP plumbing for the external secret-manager clients.
 *
 * Every provider call funnels through `vaultFetch` so the rules hold in one
 * place: a hard 15s timeout (a hung Vault must not hang a deploy forever),
 * zod-parsed response bodies (never cast), and error messages that name the
 * provider + HTTP status without ever echoing the credential or a secret
 * value. The provider's own error message IS kept: Infisical's
 * `message` and Doppler's `messages[]` say what to fix ("Folder with path
 * '/web' in environment 'prod' was not found", "You must specify a project")
 * and carry no secret material; nothing else from an error body is read.
 *
 * The provider URL is operator-supplied, so the request goes through the
 * same outbound egress policy as every other tenant-supplied destination
 * (packages/shared/src/egress-policy.ts): loopback, private, link-local and
 * cloud-metadata addresses are refused, every DNS answer for the hostname is
 * checked and the connection pinned to it, and each redirect hop is
 * re-checked. A Vault on a private network is reached by adding its address
 * to the egress allowlist (Settings, Instance), the same carve-out webhooks
 * and registries use; the control plane's own addresses stay refused
 * regardless.
 */

import {
  EgressPolicyError,
  type EgressResponse,
  egressFetch,
} from "@otterdeploy/shared/egress-policy";
import { Result } from "better-result";
import * as z from "zod";

import { controlPlaneEgressDenylist } from "../egress-denylist";
import { egressAllowlist } from "../egress-options";

const TIMEOUT_MS = 15_000;
/** Largest provider response read (a whole Vault/Doppler config fits). */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
/** Longest provider message quoted in an error. */
const PROVIDER_MESSAGE_MAX_CHARS = 300;

/** The documented message fields of an error body: Infisical `{ message }`,
 *  Doppler `{ messages: [...] }`. */
const providerErrorSchema = z.union([
  z.object({ message: z.string().min(1) }).transform((b) => b.message),
  z.object({ messages: z.array(z.string()).min(1) }).transform((b) => b.messages.join("; ")),
]);

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

/** Why the request produced no response, in the provider's words. */
function requestFailure(err: unknown): string {
  if (err instanceof EgressPolicyError && err.kind === "denied") {
    return `blocked by the outbound egress policy: ${err.message} A provider on a private network needs its address on the egress allowlist`;
  }
  if (err instanceof EgressPolicyError && /timed out/i.test(err.message)) {
    return `timed out after ${TIMEOUT_MS / 1000}s`;
  }
  return err instanceof Error ? err.message : String(err);
}

async function send(opts: VaultFetchOptions<unknown>): Promise<EgressResponse> {
  const denylist = await controlPlaneEgressDenylist();
  return egressFetch(
    opts.url,
    {
      method: opts.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    },
    {
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
      maxRedirects: 5,
      // Self-hosted Vault/Infisical often speak plain HTTP on a LAN; the
      // address policy, not the scheme, is what keeps this off internal
      // targets.
      allowHttp: true,
      denyHosts: denylist.blockedHosts,
      denyAddresses: denylist.blockedAddresses,
      allowAddresses: await egressAllowlist(),
    },
  );
}

export async function vaultFetch<T>(opts: VaultFetchOptions<T>): Promise<T> {
  const sent = await Result.tryPromise({ try: () => send(opts), catch: requestFailure });
  if (sent.isErr()) {
    throw new Error(`secret provider "${opts.providerName}": request failed (${sent.error})`);
  }
  const res = sent.value;

  if (!res.ok) {
    const text = (await Result.tryPromise({ try: () => res.text(), catch: () => "" })).unwrapOr("");
    const said = Result.try(() => providerErrorSchema.parse(JSON.parse(text)));
    const detail = said.isOk() ? ` (${said.value.slice(0, PROVIDER_MESSAGE_MAX_CHARS)})` : "";
    throw new Error(
      `secret provider "${opts.providerName}": HTTP ${res.status} from the provider API: ` +
        statusHint(res.status, res.headers.get("retry-after")) +
        detail,
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
function statusHint(status: number, retryAfter: string | null): string {
  // A rate limit is not a configuration problem (it used to read as one).
  if (status === 429) {
    return `rate limited by the provider${retryAfter ? `; retry after ${retryAfter}s` : ""}`;
  }
  if (status === 401 || status === 403) return "the stored credential was rejected";
  if (status === 404) return "the configured path/project was not found";
  if (status >= 500) return "the provider is unavailable";
  return "check the provider configuration";
}

/** Strip trailing slashes so `${base}/v1/...` concatenation stays clean. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
