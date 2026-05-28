/**
 * Thin Cloudflare API v4 client — just enough to support the
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
 * Token storage is the caller's problem — this module never touches the
 * database. The token is passed in per call so the DB layer can decide
 * about encryption-at-rest separately.
 */

const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

interface CFEnvelope<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: { code: number; message: string }[];
  result: T;
  result_info?: { page: number; per_page: number; total_pages: number };
}

async function cfFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${CLOUDFLARE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json()) as CFEnvelope<T>;
  if (!body.success) {
    const msg =
      body.errors?.[0]?.message ??
      `Cloudflare API ${res.status} ${res.statusText}`;
    throw new CloudflareError(msg, body.errors?.[0]?.code ?? res.status);
  }
  return body.result;
}

export class CloudflareError extends Error {
  readonly _tag = "CloudflareError" as const;
  constructor(message: string, public code: number) {
    super(message);
  }
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
}

export async function verifyCloudflareToken(token: string): Promise<{
  ok: boolean;
  status: string;
}> {
  try {
    const result = await cfFetch<{ id: string; status: string }>(
      "/user/tokens/verify",
      token,
    );
    return { ok: result.status === "active", status: result.status };
  } catch (err) {
    if (err instanceof CloudflareError) {
      return { ok: false, status: err.message };
    }
    throw err;
  }
}

export async function listCloudflareZones(
  token: string,
): Promise<CloudflareZone[]> {
  // The token may be scoped to a single zone — in which case `/zones`
  // still works and just returns that one zone. Iterate pages so a
  // multi-zone token returns the full list; per_page=50 is the upper
  // bound that doesn't trigger rate limits for normal use.
  const all: CloudflareZone[] = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `${CLOUDFLARE_API}/zones?per_page=50&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await res.json()) as CFEnvelope<CloudflareZone[]>;
    if (!body.success) {
      throw new CloudflareError(
        body.errors?.[0]?.message ?? "listZones failed",
        body.errors?.[0]?.code ?? res.status,
      );
    }
    all.push(...body.result.map((z) => ({ id: z.id, name: z.name, status: z.status })));
    const info = body.result_info;
    if (!info || page >= info.total_pages) break;
    page += 1;
  }
  return all;
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

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
  /** Cloudflare proxy (orange-cloud). Default false — for DNS-only A/CNAME
   *  records that the operator wants the cert issued directly against.
   *  TXT records ignore this. */
  proxied?: boolean;
  ttl?: number;
}): Promise<{ id: string }> {
  const existing = await cfFetch<DnsRecord[]>(
    `/zones/${encodeURIComponent(input.zoneId)}/dns_records?type=${input.type}&name=${encodeURIComponent(input.name)}`,
    input.token,
  );
  if (existing.length > 0) {
    const target = existing[0]!;
    await cfFetch<DnsRecord>(
      `/zones/${encodeURIComponent(input.zoneId)}/dns_records/${target.id}`,
      input.token,
      {
        method: "PATCH",
        body: JSON.stringify({
          content: input.content,
          proxied: input.proxied ?? false,
          ttl: input.ttl ?? 1, // 1 = automatic per Cloudflare convention
        }),
      },
    );
    return { id: target.id };
  }
  const created = await cfFetch<DnsRecord>(
    `/zones/${encodeURIComponent(input.zoneId)}/dns_records`,
    input.token,
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
  return { id: created.id };
}
