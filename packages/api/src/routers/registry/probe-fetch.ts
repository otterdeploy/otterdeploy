/**
 * HTTP plumbing for the registry connection probe — the timed fetch wrapper
 * and the thrown-error → operator-readable-message mapping. Split out of
 * test-connection.ts, which keeps the /v2/ handshake logic.
 *
 * `host` (and, for a bearer challenge, the token endpoint `realm`) is
 * tenant-supplied — an org can type any string as a registry host, and a
 * malicious/misconfigured registry's `WWW-Authenticate` header can point
 * the token realm anywhere. Both go through {@link egressFetch}, which
 * resolves and validates every address (denying loopback/private/link-local/
 * metadata ranges by default, plus the control plane's own identity
 * unconditionally) and pins the connection to the validated address —
 * see packages/shared/src/egress-policy.ts.
 */

import type { EgressResponse } from "@otterdeploy/shared/egress-policy";

import { egressFetch, EgressPolicyError } from "@otterdeploy/shared/egress-policy";
import { Result, TaggedError } from "better-result";

import { controlPlaneEgressDenylist } from "../../lib/egress-denylist";
import { egressAllowlist } from "../../lib/egress-options";

export const PROBE_TIMEOUT_MS = 10_000;
const PROBE_MAX_BYTES = 10 * 1024 * 1024;

export class RegistryProbeError extends TaggedError("RegistryProbeError")<{
  message: string;
  status: number | undefined;
}>() {}

export function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/** Walk err → cause → cause … collecting node error codes and messages. */
function unwrapErrorChain(err: unknown): { codes: Set<string>; texts: string[] } {
  const codes = new Set<string>();
  const texts: string[] = [];
  let cursor: unknown = err;
  for (let depth = 0; depth < 4 && cursor instanceof Error; depth++) {
    const code = (cursor as Error & { code?: unknown }).code;
    if (typeof code === "string") codes.add(code);
    texts.push(cursor.message);
    cursor = cursor.cause;
  }
  return { codes, texts };
}

function isDnsFailure(codes: Set<string>, text: string): boolean {
  return (
    codes.has("ENOTFOUND") ||
    codes.has("EAI_AGAIN") ||
    codes.has("DNSException") ||
    text.includes("dns")
  );
}

function isConnectionRefused(codes: Set<string>, text: string): boolean {
  return codes.has("ECONNREFUSED") || codes.has("ConnectionRefused") || text.includes("refused");
}

function isTlsFailure(codes: Set<string>, text: string): boolean {
  return (
    [...codes].some((c) => c.includes("CERT") || c.includes("TLS")) ||
    text.includes("certificate") ||
    text.includes("tls") ||
    text.includes("ssl")
  );
}

/** Map a thrown fetch error to an honest, operator-readable message. */
export function fetchFailure(host: string, err: unknown): RegistryProbeError {
  if (err instanceof DOMException && err.name === "TimeoutError") {
    return new RegistryProbeError({
      status: undefined,
      message: `Timed out after ${PROBE_TIMEOUT_MS / 1000}s waiting for ${host}`,
    });
  }
  // The egress policy fails closed with its own honest message (denied
  // address, denied scheme, control-plane target, redirect cap, timeout,
  // ...) — surface it as-is rather than falling through to the generic
  // "unknown network error" mapping below.
  if (err instanceof EgressPolicyError) {
    return new RegistryProbeError({ status: undefined, message: `${host}: ${err.message}` });
  }

  const { codes, texts } = unwrapErrorChain(err);
  const text = texts.join(" ").toLowerCase();

  if (isDnsFailure(codes, text)) {
    return new RegistryProbeError({
      status: undefined,
      message: `DNS lookup failed for ${host} — check the host for typos`,
    });
  }
  if (isConnectionRefused(codes, text)) {
    return new RegistryProbeError({
      status: undefined,
      message: `Connection refused by ${host} — is the registry listening on 443?`,
    });
  }
  if (isTlsFailure(codes, text)) {
    return new RegistryProbeError({
      status: undefined,
      message: `TLS handshake with ${host} failed — the registry's certificate isn't trusted`,
    });
  }
  return new RegistryProbeError({
    status: undefined,
    message: `Could not reach ${host}: ${texts[0] ?? "unknown network error"}`,
  });
}

export async function probeFetch(
  host: string,
  url: string,
  headers?: Record<string, string>,
): Promise<Result<EgressResponse, RegistryProbeError>> {
  try {
    const denylist = await controlPlaneEgressDenylist();
    const res = await egressFetch(
      url,
      { ...(headers && { headers }) },
      {
        maxRedirects: 5,
        maxBytes: PROBE_MAX_BYTES,
        timeoutMs: PROBE_TIMEOUT_MS,
        denyHosts: denylist.blockedHosts,
        denyAddresses: denylist.blockedAddresses,
        allowAddresses: await egressAllowlist(),
      },
    );
    return Result.ok(res);
  } catch (err) {
    return Result.err(fetchFailure(host, err));
  }
}
