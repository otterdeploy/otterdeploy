/**
 * Thin Cloudflare API v4 client: just enough to support the
 * "auto-configure DNS for an otterdeploy-managed apex" flow.
 *
 * Scoped to three operations:
 *   - verifyToken    → assert the API token is valid + has any access
 *   - listZones      → enumerate the zones the token can touch, so the
 *                      UI can render a dropdown rather than asking the
 *                      user to copy/paste a zone id
 *   - upsertDnsRecord → create-or-replace a TXT/A record on the chosen
 *                      zone (idempotent: if a matching record name+type
 *                      exists, we PATCH it instead of POSTing a duplicate)
 *
 * Token storage is the caller's problem. This module never touches the
 * database. The token is passed in per call so the DB layer can decide
 * about encryption-at-rest separately.
 *
 * Every operation returns `Result<_, CloudflareError>` rather than throwing.
 * These calls fail routinely and unexceptionally. A rotated token, a zone the
 * operator no longer has access to, a Cloudflare 5xx, and every caller is
 * already Result-shaped, so a thrown error just meant a `try`/`catch` adapter
 * at each site. Transport and body-parse failures are captured too, so nothing
 * here rejects.
 */

import { Result, TaggedError } from "better-result";
import * as z from "zod";

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

/** Budget for one Cloudflare call. Every call here sits on an operator's
 *  request (save settings, list zones, upsert a record), which used to hang
 *  for as long as the connection did. */
const CLOUDFLARE_REQUEST_TIMEOUT_MS = 15_000;

/** "Invalid API Token": also what `/user/tokens/verify` answers for an
 *  account-owned token, which is verified under its account instead. */
const CLOUDFLARE_INVALID_TOKEN_CODE = 1000;

/** `code` for a failure that never reached the API (DNS, TLS, timeout,
 *  unparseable body). Cloudflare's own error codes are positive, so 0 is
 *  unambiguous. */
export const CLOUDFLARE_TRANSPORT_CODE = 0;

export class CloudflareError extends TaggedError("CloudflareError")<{
  message: string;
  code: number;
  cause?: unknown;
}>() {
  constructor(message: string, code: number, cause?: unknown) {
    super({ message, code, cause });
  }
}

interface CFEnvelope<T> {
  result: T;
  result_info?: { page: number; per_page: number; total_pages: number };
}

/**
 * Tolerant probe of the envelope's error side, checked BEFORE the `result`
 * schema: an error envelope carries `result: null`, so parsing it against the
 * caller's result schema would bury Cloudflare's own error message. Loose +
 * optional throughout because the code path it feeds already treated every
 * field as possibly missing.
 */
const cfStatusSchema = z.looseObject({
  success: z.unknown().optional(),
  errors: z
    .array(z.looseObject({ code: z.number().optional(), message: z.string().optional() }))
    .optional(),
});

/** Cloudflare's own error, with the wait it asks for when it rate limits: a
 *  429 blocks the token for minutes, so the operator is told for how long
 *  rather than left to retry into the block. */
function apiFailure(
  res: Response,
  first: { code?: number; message?: string } | undefined,
): CloudflareError {
  const message = first?.message ?? `Cloudflare API ${res.status} ${res.statusText}`;
  const retryAfter = res.status === 429 ? res.headers.get("retry-after") : null;
  return new CloudflareError(
    retryAfter ? `${message} (rate limited; retry after ${retryAfter}s)` : message,
    first?.code ?? res.status,
  );
}

/**
 * One request, returning the WHOLE envelope: pagination needs `result_info`,
 * which {@link cfFetch} discards. Both live here so the `success`/`errors`
 * unwrapping is spelled exactly once. `resultSchema` validates the `result`
 * payload at the JSON boundary; a success envelope whose result doesn't match
 * it is reported as a transport-class error rather than trusted blindly.
 */
async function cfEnvelope<T>(
  path: string,
  token: string,
  resultSchema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<Result<CFEnvelope<T>, CloudflareError>> {
  // Merge via `Headers`: it accepts every HeadersInit shape (plain object,
  // entry array, Headers instance) where an object spread only handled the
  // first. Caller-provided headers still win over the defaults.
  const headers = new Headers(init.headers);
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await Result.tryPromise({
    try: () =>
      fetch(`${CLOUDFLARE_API}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(CLOUDFLARE_REQUEST_TIMEOUT_MS),
      }),
    catch: (cause) =>
      new CloudflareError(
        cause instanceof Error ? cause.message : String(cause),
        CLOUDFLARE_TRANSPORT_CODE,
        cause,
      ),
  });
  if (res.isErr()) return Result.err(res.error);

  // Cloudflare answers JSON even for its error responses, but an edge/proxy in
  // front of it may not. An HTML error page here would otherwise surface as a
  // raw SyntaxError from a module that promises not to throw.
  const body = await Result.tryPromise({
    try: (): Promise<unknown> => res.value.json(),
    catch: (cause) =>
      new CloudflareError(
        `Cloudflare API ${res.value.status} ${res.value.statusText}: unparseable response body`,
        CLOUDFLARE_TRANSPORT_CODE,
        cause,
      ),
  });
  if (body.isErr()) return Result.err(body.error);

  const status = cfStatusSchema.safeParse(body.value);
  if (!status.success) {
    return Result.err(
      new CloudflareError(
        `Cloudflare API ${res.value.status} ${res.value.statusText}: unparseable response body`,
        CLOUDFLARE_TRANSPORT_CODE,
        status.error,
      ),
    );
  }
  if (!status.data.success) return Result.err(apiFailure(res.value, status.data.errors?.[0]));

  const envelope = z
    .looseObject({
      result: resultSchema,
      result_info: z
        .object({ page: z.number(), per_page: z.number(), total_pages: z.number() })
        .optional(),
    })
    .safeParse(body.value);
  if (!envelope.success) {
    return Result.err(
      new CloudflareError(
        `Cloudflare API ${res.value.status} ${res.value.statusText}: unexpected response shape`,
        CLOUDFLARE_TRANSPORT_CODE,
        envelope.error,
      ),
    );
  }
  return Result.ok({ result: envelope.data.result, result_info: envelope.data.result_info });
}

/** One request, unwrapped to its `result` payload. */
async function cfFetch<T>(
  path: string,
  token: string,
  resultSchema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<Result<T, CloudflareError>> {
  return (await cfEnvelope(path, token, resultSchema, init)).map((body) => body.result);
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

const cloudflareZoneSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  status: z.string(),
});

const tokenVerifySchema = z.looseObject({ status: z.string() });

/**
 * Ask Cloudflare what it thinks of this token.
 *
 * An `Err` means Cloudflare rejected the request outright (or we couldn't
 * reach it). An `Ok` means it answered, but the token is only usable when
 * `active` is true; Cloudflare reports a disabled or expired token as a
 * successful response carrying a non-`"active"` status. Callers must check
 * both, which is why the status string is returned rather than folded into a
 * bare boolean.
 */
export async function verifyCloudflareToken(
  token: string,
): Promise<Result<{ active: boolean; status: string }, CloudflareError>> {
  const result = await cfFetch("/user/tokens/verify", token, tokenVerifySchema);
  if (result.isOk() || result.error.code !== CLOUDFLARE_INVALID_TOKEN_CODE) {
    return result.map((r) => ({ active: r.status === "active", status: r.status }));
  }
  // An account-owned token (what Cloudflare recommends for integrations) is
  // only known to `/accounts/{id}/tokens/verify`, and the account id is not
  // something the operator gives us. The product only ever uses the token
  // for zones and DNS records, so a token that sees at least one zone is a
  // working token. One that sees none (Cloudflare answers a disabled token's
  // zone list with an empty page) keeps the rejection.
  const zones = await cfFetch("/zones?per_page=5", token, z.array(cloudflareZoneSchema));
  return zones.isOk() && zones.value.length > 0
    ? Result.ok({ active: true, status: "active" })
    : Result.err(result.error);
}

export async function listCloudflareZones(
  token: string,
): Promise<Result<CloudflareZone[], CloudflareError>> {
  // The token may be scoped to a single zone. In which case `/zones`
  // still works and just returns that one zone. Iterate pages so a
  // multi-zone token returns the full list; per_page=50 is the upper
  // bound that doesn't trigger rate limits for normal use.
  const all: CloudflareZone[] = [];
  let page = 1;
  while (true) {
    const body = await cfEnvelope(
      `/zones?per_page=50&page=${page}`,
      token,
      z.array(cloudflareZoneSchema),
    );
    if (body.isErr()) return Result.err(body.error);

    all.push(...body.value.result.map((z) => ({ id: z.id, name: z.name, status: z.status })));
    const info = body.value.result_info;
    if (!info || page >= info.total_pages) break;
    page += 1;
  }
  return Result.ok(all);
}

const dnsRecordSchema = z.looseObject({
  id: z.string(),
});

/**
 * Idempotent upsert. Lists records matching name+type on the zone; if
 * present, patches the content; if absent, posts a new one. Returns the
 * final record id either way so the caller can audit which Cloudflare
 * record they own.
 */
export async function upsertCloudflareDnsRecord(input: {
  token: string;
  zoneId: string;
  type: "A" | "TXT" | "CNAME";
  name: string;
  content: string;
  /** Cloudflare proxy (orange-cloud). Default false: for DNS-only A/CNAME
   *  records that the operator wants the cert issued directly against.
   *  TXT records ignore this. */
  proxied?: boolean;
  ttl?: number;
}): Promise<Result<{ id: string }, CloudflareError>> {
  const existing = await findDnsRecords(input);
  if (existing.isErr()) return Result.err(existing.error);

  const target = existing.value[0];
  if (target) {
    const patched = await cfFetch(
      `/zones/${encodeURIComponent(input.zoneId)}/dns_records/${target.id}`,
      input.token,
      dnsRecordSchema,
      {
        method: "PATCH",
        body: JSON.stringify({
          content: input.content,
          proxied: input.proxied ?? false,
          ttl: input.ttl ?? 1, // 1 = automatic per Cloudflare convention
        }),
      },
    );
    return patched.map(() => ({ id: target.id }));
  }
  return createDnsRecord(input);
}

type DnsRecordInput = Parameters<typeof upsertCloudflareDnsRecord>[0];

/** The zone's records with exactly this name and type. */
function findDnsRecords(
  input: Pick<DnsRecordInput, "token" | "zoneId" | "type" | "name">,
): Promise<Result<{ id: string }[], CloudflareError>> {
  return cfFetch(
    `/zones/${encodeURIComponent(input.zoneId)}/dns_records?type=${input.type}&name=${encodeURIComponent(input.name)}`,
    input.token,
    z.array(dnsRecordSchema),
  );
}

async function createDnsRecord(
  input: DnsRecordInput,
): Promise<Result<{ id: string }, CloudflareError>> {
  const created = await cfFetch(
    `/zones/${encodeURIComponent(input.zoneId)}/dns_records`,
    input.token,
    dnsRecordSchema,
    {
      method: "POST",
      body: JSON.stringify({
        type: input.type,
        name: input.name,
        content: input.content,
        proxied: input.proxied ?? false,
        ttl: input.ttl ?? 1,
      }),
    },
  );
  return created.map((r) => ({ id: r.id }));
}

/**
 * Create the record only when the zone has none of that name and type.
 *
 * {@link upsertCloudflareDnsRecord} is for a write the operator asked for: it
 * repoints whatever is there. This is for a repair nobody asked for in that
 * moment (adding a record an older version forgot), which must never
 * overwrite a record the operator set up themselves, proxied or pointed
 * elsewhere on purpose.
 */
export async function ensureCloudflareDnsRecord(
  input: DnsRecordInput,
): Promise<Result<{ id: string; created: boolean }, CloudflareError>> {
  const existing = await findDnsRecords(input);
  if (existing.isErr()) return Result.err(existing.error);
  const present = existing.value[0];
  if (present) return Result.ok({ id: present.id, created: false });
  return (await createDnsRecord(input)).map((r) => ({ id: r.id, created: true }));
}

/** One zone by id: how a stored zone id becomes a name the operator knows.
 *  Also the cheapest live proof that a stored token still works. */
export async function getCloudflareZone(
  token: string,
  zoneId: string,
): Promise<Result<CloudflareZone, CloudflareError>> {
  return (await cfFetch(`/zones/${encodeURIComponent(zoneId)}`, token, cloudflareZoneSchema)).map(
    (zone) => ({ id: zone.id, name: zone.name, status: zone.status }),
  );
}

/** Cloudflare's answers for a token it no longer accepts: invalid (1000),
 *  bad or expired access token (9109), authentication error (10000), and
 *  the token-format errors (6003, 6111). */
const CLOUDFLARE_REJECTED_TOKEN_CODES = new Set([1000, 6003, 6111, 9109, 10000]);

export function isRejectedTokenError(error: CloudflareError): boolean {
  return (
    CLOUDFLARE_REJECTED_TOKEN_CODES.has(error.code) || error.code === 401 || error.code === 403
  );
}
