const CACHE_LOOKUP_HEADERS = ["if-modified-since", "if-none-match", "range"] as const;

/**
 * Artifacts never vary by query string or representation headers. Normalising
 * every GET and HEAD request to one query-free GET key prevents cache
 * fragmentation while allowing HEAD to reuse a cached GET. Conditional and
 * range headers are retained because Cloudflare's Cache API reads them during
 * `match()` to produce 304 and partial responses from a warm cache; they do not
 * change the stored cache identity.
 */
export function artifactCacheKey(request: Request): Request {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  const headers = new Headers();
  for (const name of CACHE_LOOKUP_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Request(url, { headers, method: "GET" });
}
