/**
 * Docker Registry HTTP API v2 connection probe.
 *
 * The handshake (https://distribution.github.io/distribution/spec/api/):
 *
 *   1. GET https://<host>/v2/
 *      200 → reachable, no auth required (or ambient auth accepted).
 *      401 → read the `WWW-Authenticate` challenge.
 *   2. Bearer challenge → GET <realm>?service=…(&scope=…) with the
 *      credentials as HTTP basic auth. 200 + a token in the body means the
 *      registry's auth service accepted them; 401/403 means it didn't.
 *      Basic challenge → retry GET /v2/ with basic auth directly.
 *
 * No db imports here — the module stays unit-testable without the env/db
 * bootstrapping the rest of the router pulls in. Stored-credential lookup
 * lives in queries.ts; the handler in index.ts glues the two together;
 * the timed fetch + network-error mapping live in probe-fetch.ts.
 *
 * Honesty note: when a bearer challenge carries no scope (the common case
 * for a bare /v2/ ping), some registries mint an anonymous token even for
 * bad credentials. The success message says what was actually verified.
 */

import { Result } from "better-result";

import { basicAuthHeader, probeFetch, RegistryProbeError } from "./probe-fetch";

export { RegistryProbeError } from "./probe-fetch";

export interface BearerChallenge {
  scheme: "bearer";
  realm: string;
  service?: string;
  scope?: string;
}

export type AuthChallenge = BearerChallenge | { scheme: "basic" };

/**
 * Parse a `WWW-Authenticate` header into the challenge we know how to
 * follow. Returns null for a missing header, an unsupported scheme
 * (Negotiate, Digest, …), or a Bearer challenge without a realm.
 */
export function parseAuthChallenge(header: string | null): AuthChallenge | null {
  if (!header) return null;
  const trimmed = header.trim();
  const spaceIdx = trimmed.indexOf(" ");
  const scheme = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();

  if (scheme === "basic") return { scheme: "basic" };
  if (scheme !== "bearer" || spaceIdx === -1) return null;

  // key="quoted value" or key=token, comma-separated. Quoted values in
  // registry challenges don't contain escaped quotes in practice.
  const params: Record<string, string> = {};
  const re = /([a-zA-Z][a-zA-Z0-9_-]*)=(?:"([^"]*)"|([^",\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed.slice(spaceIdx + 1))) !== null) {
    const [, key, quoted, bare] = m;
    if (key === undefined) continue;
    params[key.toLowerCase()] = quoted ?? bare ?? "";
  }

  const realm = params["realm"];
  if (!realm) return null;
  return {
    scheme: "bearer",
    realm,
    ...(params["service"] !== undefined && { service: params["service"] }),
    ...(params["scope"] !== undefined && { scope: params["scope"] }),
  };
}

/**
 * Token-endpoint URL for a bearer challenge. Preserves any query params
 * already baked into the realm and appends service/scope from the
 * challenge. Throws (TypeError) when the realm isn't an absolute URL —
 * the caller maps that to a protocol error.
 */
export function buildTokenUrl(challenge: BearerChallenge): string {
  const url = new URL(challenge.realm);
  if (challenge.service) url.searchParams.set("service", challenge.service);
  if (challenge.scope) url.searchParams.set("scope", challenge.scope);
  return url.toString();
}

type ProbeOutcome = Result<{ status: number; message: string }, RegistryProbeError>;

/** Basic challenge: retry the /v2/ handshake with the credentials attached. */
async function probeWithBasicAuth(host: string, auth: string): Promise<ProbeOutcome> {
  const retry = await probeFetch(host, `https://${host}/v2/`, { authorization: auth });
  if (retry.isErr()) return Result.err(retry.error);
  if (retry.value.ok) {
    return Result.ok({
      status: retry.value.status,
      message: `Credentials accepted by ${host} (basic auth)`,
    });
  }
  if (retry.value.status === 401 || retry.value.status === 403) {
    return Result.err(
      new RegistryProbeError({
        status: retry.value.status,
        message: `${host} rejected the credentials (${retry.value.status}) — check username and password/token`,
      }),
    );
  }
  return Result.err(
    new RegistryProbeError({
      status: retry.value.status,
      message: `${host} responded ${retry.value.status} to the authenticated handshake`,
    }),
  );
}

/** Bearer challenge: exchange basic credentials for a token at the realm. */
async function probeWithBearerToken(
  host: string,
  challenge: BearerChallenge,
  auth: string,
): Promise<ProbeOutcome> {
  let tokenUrl: string;
  try {
    tokenUrl = buildTokenUrl(challenge);
  } catch {
    return Result.err(
      new RegistryProbeError({
        status: 401,
        message: `${host} sent a malformed auth challenge (realm "${challenge.realm}" is not a URL)`,
      }),
    );
  }

  const tokenRes = await probeFetch(host, tokenUrl, { authorization: auth });
  if (tokenRes.isErr()) return Result.err(tokenRes.error);

  if (tokenRes.value.status === 401 || tokenRes.value.status === 403) {
    return Result.err(
      new RegistryProbeError({
        status: tokenRes.value.status,
        message: `${host} rejected the credentials (${tokenRes.value.status} from its token endpoint) — check username and password/token`,
      }),
    );
  }
  if (!tokenRes.value.ok) {
    return Result.err(
      new RegistryProbeError({
        status: tokenRes.value.status,
        message: `${host}'s token endpoint responded ${tokenRes.value.status} — couldn't verify credentials`,
      }),
    );
  }

  const body = (await tokenRes.value.json().catch(() => null)) as {
    token?: string;
    access_token?: string;
  } | null;
  if (!body || (!body.token && !body.access_token)) {
    return Result.err(
      new RegistryProbeError({
        status: tokenRes.value.status,
        message: `${host}'s token endpoint answered 200 but returned no token`,
      }),
    );
  }

  return Result.ok({
    status: tokenRes.value.status,
    message: `Credentials accepted by ${host}'s token endpoint`,
  });
}

/**
 * Probe a registry host with the given credentials. HTTPS only — that's
 * the same constraint the builder's `docker push`/`docker pull` operate
 * under for non-localhost hosts.
 */
export async function probeRegistry(input: {
  host: string;
  username: string;
  password: string;
}): Promise<ProbeOutcome> {
  const { host, username, password } = input;

  const ping = await probeFetch(host, `https://${host}/v2/`);
  if (ping.isErr()) return Result.err(ping.error);

  if (ping.value.ok) {
    return Result.ok({
      status: ping.value.status,
      message: `${host} answered the v2 handshake — no auth required`,
    });
  }

  if (ping.value.status !== 401) {
    return Result.err(
      new RegistryProbeError({
        status: ping.value.status,
        message: `${host} responded ${ping.value.status} to /v2/ — not a Docker Registry v2 endpoint?`,
      }),
    );
  }

  const challenge = parseAuthChallenge(ping.value.headers.get("www-authenticate"));
  if (!challenge) {
    return Result.err(
      new RegistryProbeError({
        status: 401,
        message: `${host} returned 401 without a challenge this probe can follow — can't verify credentials`,
      }),
    );
  }

  if (!username || !password) {
    return Result.err(
      new RegistryProbeError({
        status: 401,
        message: `${host} requires authentication — enter a username and password/token to test`,
      }),
    );
  }

  const auth = basicAuthHeader(username, password);
  if (challenge.scheme === "basic") return probeWithBasicAuth(host, auth);
  return probeWithBearerToken(host, challenge, auth);
}
