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
  const res = await Result.tryPromise({
    try: () =>
      fetch(`${CLOUDFLARE_API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
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
  if (!status.data.success) {
    return Result.err(
      new CloudflareError(
        status.data.errors?.[0]?.message ??
          `Cloudflare API ${res.value.status} ${res.value.statusText}`,
        status.data.errors?.[0]?.code ?? res.value.status,
      ),
    );
  }

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
  return result.map((r) => ({ active: r.status === "active", status: r.status }));
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
  const existing = await cfFetch(
    `/zones/${encodeURIComponent(input.zoneId)}/dns_records?type=${input.type}&name=${encodeURIComponent(input.name)}`,
    input.token,
    z.array(dnsRecordSchema),
  );
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
