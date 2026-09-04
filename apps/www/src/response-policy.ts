import { isCanonicalHost } from "./lib/shared";

const SITE_SECURITY_HEADERS = [
  ["Content-Security-Policy", "base-uri 'self'; frame-ancestors 'none'; object-src 'none'"],
  ["Permissions-Policy", "camera=(), geolocation=(), microphone=(), payment=(), usb=()"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
] as const;

const HSTS = ["Strict-Transport-Security", "max-age=31536000"] as const;

/**
 * Add headers without assuming the response's Headers guard is mutable.
 * Preserve the original response when possible so TanStack keeps its private
 * streamed-response cleanup metadata; otherwise transfer the body stream into
 * a response with a mutable copy of the headers.
 */
export function withResponseHeaders(
  response: Response,
  entries: ReadonlyArray<readonly [string, string]>,
): Response {
  try {
    for (const [name, value] of entries) response.headers.set(name, value);
    return response;
  } catch {
    // An immutable Headers guard is not observable through the web API, so the
    // failed write is the only portable way to distinguish this case.
  }

  const headers = new Headers(response.headers);
  for (const [name, value] of entries) headers.set(name, value);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Add the preview indexing policy without assuming response headers are
 * mutable. Standards-compliant runtimes give redirects and some other
 * synthetic responses an immutable header guard, so an unconditional
 * `response.headers.set()` can turn an otherwise valid response into a 500.
 *
 * Prefer mutation when the response allows it: TanStack Start recognizes the
 * original streamed response and retains its cleanup metadata. A guarded
 * response cannot be mutated, so copy its response shell and headers while
 * transferring (not cloning/teeing) the body stream.
 */
export function withPreviewNoIndex(response: Response): Response {
  return withResponseHeaders(response, [["X-Robots-Tag", "noindex, nofollow"]]);
}

/**
 * Browser hardening for Worker-generated responses.
 *
 * HSTS is deliberately host-only: get.otterdeploy.com is a separate Worker
 * and must prove its own HTTPS redirect before includeSubDomains is safe.
 * The Worker path omits HSTS over HTTP. Static assets use Cloudflare's
 * scheme-blind `_headers` file instead; browsers ignore its HTTP copy.
 */
export function withSiteSecurityHeaders(request: Request, response: Response): Response {
  const forwardedProtocolHeader = request.headers.get("x-forwarded-proto");
  const forwardedProtocol = forwardedProtocolHeader?.split(",", 1)[0]?.trim().toLowerCase();
  const isHttps =
    forwardedProtocol === "https" ||
    (forwardedProtocolHeader === null && new URL(request.url).protocol === "https:");
  const entries =
    isHttps && isCanonicalHost(request.url)
      ? [...SITE_SECURITY_HEADERS, HSTS]
      : SITE_SECURITY_HEADERS;

  return withResponseHeaders(response, entries);
}
