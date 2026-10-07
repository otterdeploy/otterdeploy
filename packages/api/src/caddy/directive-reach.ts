import {
  filePathReachError,
  upstreamReachError,
} from "@otterdeploy/shared/custom-directives-reach";

/**
 * The reach rules for raw per-route directives, applied to the JSON
 * Caddy's own /adapt produced, i.e. after Caddy has lexed, substituted and
 * parsed the text. The write schema already rejects these by reading the
 * Caddyfile tokens (packages/shared/src/custom-directives-reach.ts); this is
 * the same policy on the form Caddy will actually run, so any difference
 * between that lexer and Caddy's cannot carry a forbidden handler through.
 *
 * Only run on fragments that carry custom directives. The generated parts of
 * a fragment do reach the platform on purpose: the forward_auth gate and the
 * reserved auth path dial the control plane, the access log streams to the
 * edge-log sink, an uploaded certificate is loaded from /etc/caddy/certs. The
 * reconciler passes exactly those strings as `generated`, so a
 * hit here is the operator's text and the generated config is never mistaken
 * for it.
 */
export function adaptedReachError(
  json: unknown,
  generated: ReadonlySet<string> = new Set(),
): string | null {
  if (Array.isArray(json)) {
    for (const item of json) {
      const error = adaptedReachError(item, generated);
      if (error) return error;
    }
    return null;
  }
  if (typeof json === "string") {
    for (const placeholder of json.matchAll(/\{file\.([^}]*)\}?/g)) {
      const error = filePathReachError(placeholder[1] ?? "", "The {file.*} placeholder");
      if (error) return error;
    }
    return null;
  }
  if (typeof json !== "object" || json === null) return null;

  const error = handlerReachError(new Map(Object.entries(json)), generated);
  if (error) return error;
  for (const value of Object.values(json)) {
    const nested = adaptedReachError(value, generated);
    if (nested) return nested;
  }
  return null;
}

/** An address Caddy will dial, unless the generator itself put it there. */
function dialReachError(address: string, generated: ReadonlySet<string>): string | null {
  return generated.has(address) ? null : upstreamReachError(address);
}

function stringAt(node: Map<string, unknown>, key: string): string | null {
  const value = node.get(key);
  return typeof value === "string" ? value : null;
}

/** The handler-specific rules for one adapted JSON object. */
function handlerReachError(
  node: Map<string, unknown>,
  generated: ReadonlySet<string>,
): string | null {
  const handler = stringAt(node, "handler");
  if (handler === "acme_server") {
    return "acme_server is not allowed in route directives: it would issue certificates from the edge's own CA.";
  }
  return (
    (handler === "reverse_proxy" ? proxyReachError(node, generated) : null) ??
    (handler === null ? certificateReachError(node, generated) : null) ??
    sinkReachError(node, generated) ??
    rootReachError(handler, node)
  );
}

/** A value nested under `path` in an adapted JSON object, when it is a string. */
function nestedString(node: Map<string, unknown>, path: readonly string[]): string | null {
  let current: unknown = Object.fromEntries(node);
  for (const key of path) {
    if (typeof current !== "object" || current === null) return null;
    current = new Map(Object.entries(current)).get(key);
  }
  return typeof current === "string" ? current : null;
}

/**
 * Addresses outside a proxy's upstream list that Caddy still dials or fetches
 * a log's `net` writer, a `get_certificate http` manager, and an
 * ACME issuer's directory URL.
 */
function sinkReachError(node: Map<string, unknown>, generated: ReadonlySet<string>): string | null {
  const sinks = [
    stringAt(node, "output") === "net" ? stringAt(node, "address") : null,
    stringAt(node, "via") === "http" ? stringAt(node, "url") : null,
    stringAt(node, "module") === "acme" ? stringAt(node, "ca") : null,
    stringAt(node, "module") === "acme" ? stringAt(node, "test_ca") : null,
  ];
  for (const sink of sinks) {
    const error = sink === null ? null : dialReachError(sink, generated);
    if (error) return error;
  }
  return null;
}

/** A reverse_proxy's static and dynamic upstreams, the address its active
 *  health check dials, and its http transport's forward proxy. */
function proxyReachError(
  node: Map<string, unknown>,
  generated: ReadonlySet<string>,
): string | null {
  return proxySideDialError(node, generated) ?? proxyUpstreamsError(node, generated);
}

/** What a reverse_proxy dials besides its upstreams: the active health
 *  check's `upstream` and the http transport's `forward_proxy_url`. */
function proxySideDialError(
  node: Map<string, unknown>,
  generated: ReadonlySet<string>,
): string | null {
  const dialed = [
    nestedString(node, ["health_checks", "active", "upstream"]),
    nestedString(node, ["transport", "forward_proxy_url"]),
  ];
  for (const address of dialed) {
    const error = address === null ? null : dialReachError(address, generated);
    if (error) return error;
  }
  return null;
}

function proxyUpstreamsError(
  node: Map<string, unknown>,
  generated: ReadonlySet<string>,
): string | null {
  const upstreams = node.get("upstreams");
  for (const upstream of Array.isArray(upstreams) ? upstreams : []) {
    const dial =
      typeof upstream === "object" && upstream !== null
        ? new Map(Object.entries(upstream)).get("dial")
        : undefined;
    const error = typeof dial === "string" ? dialReachError(dial, generated) : null;
    if (error) return error;
  }
  const dynamic = node.get("dynamic_upstreams");
  if (typeof dynamic !== "object" || dynamic === null) return null;
  const source = new Map(Object.entries(dynamic));
  const name = stringAt(source, "name") ?? "";
  const port = stringAt(source, "port") ?? "";
  return name || port ? dialReachError(`${name}:${port}`, generated) : null;
}

/** Certificate files a `tls <cert> <key>` directive loads (tls.load_files). */
function certificateReachError(
  node: Map<string, unknown>,
  generated: ReadonlySet<string>,
): string | null {
  const certificate = stringAt(node, "certificate");
  const key = stringAt(node, "key");
  if (certificate === null || key === null) return null;
  if (generated.has(certificate) && generated.has(key)) return null;
  return filePathReachError(certificate, "tls file") ?? filePathReachError(key, "tls file");
}

/** file_server/templates roots, the `root` var file_server defaults to, and a
 *  fastcgi transport's document root. */
function rootReachError(handler: string | null, node: Map<string, unknown>): string | null {
  const key =
    handler === "templates"
      ? "file_root"
      : handler === "file_server" || handler === "vars" || stringAt(node, "protocol") === "fastcgi"
        ? "root"
        : null;
  const root = key === null ? null : stringAt(node, key);
  return root === null ? null : filePathReachError(root, "root");
}
