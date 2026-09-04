const PUBLIC_HOST = "get.otterdeploy.com";
const HSTS = "max-age=31536000";

/** Match only the public hostname or the same DNS name with one root dot. */
function isPublicHost(hostname: string): boolean {
  return hostname === PUBLIC_HOST || hostname === `${PUBLIC_HOST}.`;
}

function permanentRedirect(location: URL | string): Response {
  return new Response(null, {
    // 308 preserves HEAD and any method a future route may deliberately add.
    status: 308,
    headers: {
      Location: location.toString(),
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

function requestProtocol(request: Request): string {
  const forwardedProtocol = request.headers.get("x-forwarded-proto");
  return (
    forwardedProtocol?.split(",", 1)[0]?.trim().toLowerCase() ??
    new URL(request.url).protocol.replace(/:$/, "")
  );
}

/** Redirect the public artifact edge to HTTPS without breaking local Wrangler. */
export function httpsRedirectFor(request: Request): Response | null {
  const url = new URL(request.url);
  if (!isPublicHost(url.hostname)) return null;

  let changed = false;

  if (url.hostname !== PUBLIC_HOST) {
    url.hostname = PUBLIC_HOST;
    changed = true;
  }

  // Cloudflare supplies x-forwarded-proto; the URL protocol is the fallback
  // for direct tests and runtimes that do not sit behind its proxy.
  if (requestProtocol(request) === "http" || url.protocol !== "https:") {
    url.protocol = "https:";
    changed = true;
  }

  if (url.port !== "") {
    url.port = "";
    changed = true;
  }

  if (!changed) return null;

  // Preserve the method so an unsupported POST remains a POST and reaches
  // the HTTPS handler's 405 instead of being rewritten into an artifact GET.
  return permanentRedirect(url);
}

/**
 * Resolve public redirects before routing. The root goes straight to its HTTPS
 * documentation destination, even from HTTP, rather than upgrading the empty
 * artifact URL first and creating a two-hop chain.
 */
export function publicRedirectFor(request: Request, docsUrl: string): Response | null {
  const url = new URL(request.url);
  if (
    isPublicHost(url.hostname) &&
    url.pathname === "/" &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return permanentRedirect(docsUrl);
  }

  return httpsRedirectFor(request);
}

/** Add host-only HSTS to HTTPS responses, preserving immutable responses. */
export function withArtifactSecurityHeaders(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  // The artifact host serves shell, YAML, JSON and probe responses, not search
  // landing pages. Crawlers may fetch them, but none should become a result.
  headers.set("X-Robots-Tag", "noindex");

  const url = new URL(request.url);
  if (isPublicHost(url.hostname) && requestProtocol(request) === "https") {
    headers.set("Strict-Transport-Security", HSTS);
  }

  try {
    for (const [name, value] of headers) response.headers.set(name, value);
    return response;
  } catch {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
