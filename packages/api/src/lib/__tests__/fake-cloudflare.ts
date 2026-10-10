/**
 * An in-memory Cloudflare v4 API, just wide enough for the DNS-record calls
 * in ../cloudflare.ts: list by name+type, create, patch, and read a zone.
 *
 * Stubbed in as the global `fetch`, so tests drive the real client and can
 * assert on the zone's final record set, which is what "idempotent" means in
 * practice: a second run leaves the zone exactly as the first one did.
 */

import * as z from "zod";

export interface FakeDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
}

const writeBodySchema = z.looseObject({
  type: z.string().optional(),
  name: z.string().optional(),
  content: z.string().optional(),
  proxied: z.boolean().optional(),
});

function ok(result: unknown): Response {
  return Response.json({ success: true, errors: [], messages: [], result });
}

function fail(status: number, code: number, message: string): Response {
  return Response.json({ success: false, errors: [{ code, message }], result: null }, { status });
}

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

export function fakeCloudflare(options: {
  zoneId: string;
  zoneName: string;
  records?: FakeDnsRecord[];
  /** Answer every call the way Cloudflare answers a revoked token. */
  rejectToken?: boolean;
}) {
  const records: FakeDnsRecord[] = (options.records ?? []).map((r) => ({ ...r }));
  const calls: { method: string; path: string }[] = [];
  let seq = 0;

  async function fetchImpl(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const url = requestUrl(input);
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/client\/v4/, "");
    calls.push({ method, path });

    if (options.rejectToken) return fail(401, 1000, "Invalid API Token");

    const zonePrefix = `/zones/${options.zoneId}`;
    if (!path.startsWith(zonePrefix)) return fail(404, 7003, "Could not route to zone");

    const rest = path.slice(zonePrefix.length);
    if (rest === "" && method === "GET") {
      return ok({ id: options.zoneId, name: options.zoneName, status: "active" });
    }

    const body = typeof init?.body === "string" ? writeBodySchema.parse(JSON.parse(init.body)) : {};

    if (rest === "/dns_records" && method === "GET") {
      const type = url.searchParams.get("type");
      const name = url.searchParams.get("name");
      return ok(records.filter((r) => (!type || r.type === type) && (!name || r.name === name)));
    }

    if (rest === "/dns_records" && method === "POST") {
      const name = body.name ?? "";
      // Cloudflare refuses a record outside the zone it was written to.
      if (name !== options.zoneName && !name.endsWith(`.${options.zoneName}`)) {
        return fail(400, 9005, "Record name is not in the zone");
      }
      seq += 1;
      const created: FakeDnsRecord = {
        id: `rec_${seq}`,
        type: body.type ?? "",
        name,
        content: body.content ?? "",
        proxied: body.proxied ?? false,
      };
      records.push(created);
      return ok(created);
    }

    const recordMatch = /^\/dns_records\/([^/]+)$/.exec(rest);
    if (recordMatch && method === "PATCH") {
      const target = records.find((r) => r.id === recordMatch[1]);
      if (!target) return fail(404, 81044, "Record does not exist");
      if (body.content !== undefined) target.content = body.content;
      if (body.proxied !== undefined) target.proxied = body.proxied;
      return ok(target);
    }

    return fail(404, 7000, `No route for ${method} ${path}`);
  }

  return { fetch: fetchImpl, records, calls };
}
