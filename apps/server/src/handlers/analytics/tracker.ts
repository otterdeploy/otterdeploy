import type { Context } from "hono";

import { getTrackerScript } from "@otterdeploy/api/analytics/tracker";

/** True when the request's If-None-Match names `etag` (weak or strong, list or `*`). */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || trimmed.replace(/^W\//, "") === etag;
  });
}

/**
 * GET /a/otter.js: the browser tracker. Public, cacheable for an hour (the
 * snippet is `<script async src>` on third-party sites, so the CDN/browser
 * cache carries most of the load); ETag revalidation keeps the stale window
 * cheap. Registered by ./index.ts.
 */
export async function handleTrackerScript(c: Context): Promise<Response> {
  const { body, etag } = await getTrackerScript();
  c.header("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  c.header("ETag", etag);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Access-Control-Allow-Origin", "*");
  if (matchesEtag(c.req.header("if-none-match"), etag)) {
    return c.body(null, 304);
  }
  c.header("Content-Type", "application/javascript; charset=utf-8");
  return c.body(body, 200);
}
