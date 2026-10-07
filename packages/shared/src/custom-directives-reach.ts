/**
 * What raw per-route Caddy directives may REACH.
 *
 * Raw directives stay a core feature: operators
 * write `header`, `redir`, `rewrite`, `encode`, `handle_errors`, matchers and
 * `reverse_proxy` to their own services. What a directive must never reach is
 * the edge's own control surface. The text runs inside the Caddy container,
 * where the admin API listens on a Unix socket (or :2019 when bound to TCP),
 * `/data` holds every certificate and private key, `/etc/caddy` holds the live
 * config, and `/config` its autosave. A `reverse_proxy` to the admin socket
 * turns a public domain into an unauthenticated proxy to that API.
 *
 * This is a token-level pass that mirrors Caddy's lexer closely enough to see
 * every directive and argument; it rejects with a message the editor shows
 * verbatim. The adapted JSON is checked again on the server
 * (packages/api/src/caddy/directive-reach.ts), so anything this lexer reads
 * differently from Caddy still meets the same rules after Caddy has parsed it.
 *
 * Pure (no node:*) because the dashboard runs it as form validation too.
 */

import { type DirectiveLine, lexDirectives } from "./caddyfile-lexer";
import { canonicalHostname, isLinkLocalHost, platformHostError } from "./platform-hosts";

/** The only directory file_server/root/{file.*} may read from. It is the Caddy
 *  image's own site root, and nothing from the install is mounted under it. */
export const DIRECTIVE_FILE_ROOT = "/srv";

/** Caddy's admin API port when it is bound to TCP instead of the socket. */
const CADDY_ADMIN_PORT = 2019;

/** Directives that dial an upstream address. */
const UPSTREAM_DIRECTIVES = new Set(["reverse_proxy", "forward_auth", "php_fastcgi"]);

/** A leading matcher token (`*`, `/path`, `@name`) is not an argument. */
function withoutMatcher(args: string[]): string[] {
  const first = args[0];
  if (first !== undefined && (first === "*" || first.startsWith("/") || first.startsWith("@"))) {
    return args.slice(1);
  }
  return args;
}

function isLoopbackHost(host: string): boolean {
  const h = canonicalHostname(host);
  if (h === "" || h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0" || h.startsWith("127.")) return true;
  if (h === "[::]" || h === "[::1]") return true;
  // IPv4-mapped IPv6 loopback/unspecified (::ffff:127.x.x.x, ::ffff:0.0.0.0).
  return /^\[::ffff:(7f[0-9a-f]{2}:[0-9a-f]{1,4}|0:0)\]$/.test(h);
}

/** Does a port spec (`2019`, `2000-2100`) include the admin port? */
function includesAdminPort(spec: string): boolean {
  const range = /^(\d+)(?:-(\d+))?$/.exec(spec);
  if (!range) return false;
  const low = Number(range[1]);
  const high = range[2] === undefined ? low : Number(range[2]);
  return low <= CADDY_ADMIN_PORT && CADDY_ADMIN_PORT <= high;
}

/** An upstream address split the way Caddy's dialer reads it. */
export interface UpstreamEndpoint {
  /** `unix`, `tcp`, `udp`... when the address names a network, else null. */
  network: string | null;
  host: string;
  port: string;
}

/**
 * Split every spelling Caddy accepts: `host:port`, `scheme://host:port/path`,
 * `network/address` (`unix//path`, `tcp/host:port`), bracketed IPv6.
 */
export function upstreamEndpoint(address: string): UpstreamEndpoint {
  let rest = address.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const networked = /^([a-z0-9+]+)\/(.*)$/i.exec(rest);
  const network = networked ? (networked[1] ?? "").toLowerCase() : null;
  if (networked) rest = networked[2] ?? "";
  rest = rest.replace(/\/.*$/, "");
  // A URL's userinfo (`http://user:pass@host`) is not the host.
  rest = rest.slice(rest.lastIndexOf("@") + 1);
  const bracketed = /^(\[[^\]]*\])(?::(.*))?$/.exec(rest);
  const lastColon = rest.lastIndexOf(":");
  const [host, port] = bracketed
    ? [bracketed[1] ?? "", bracketed[2] ?? ""]
    : rest.indexOf(":") !== lastColon
      ? [rest, ""] // a bare IPv6 literal
      : lastColon === -1
        ? [rest, ""]
        : [rest.slice(0, lastColon), rest.slice(lastColon + 1)];
  return { network, host, port };
}

/** Why a host may not be dialed from a route directive, or null: the edge
 *  itself (loopback), the cloud metadata/link-local range, or the platform's
 *  own containers and the Docker host (./platform-hosts). */
function hostReachError(host: string, quoted: string): string | null {
  if (isLoopbackHost(host)) {
    return `Upstream ${quoted} is a loopback address: route directives run inside the edge, so it reaches Caddy itself, not your services. Proxy to the service name instead.`;
  }
  if (isLinkLocalHost(host)) {
    return `Upstream ${quoted} is a link-local address (cloud metadata lives there): route directives cannot reach it.`;
  }
  const platform = platformHostError(host);
  return platform === null ? null : `Upstream ${platform}`;
}

/**
 * Why an upstream address may not be dialed from a route directive, or null.
 * Accepts every spelling Caddy does (see upstreamEndpoint).
 */
export function upstreamReachError(address: string): string | null {
  const quoted = JSON.stringify(address);
  if (address.includes("{")) {
    return `Upstream ${quoted} uses a placeholder: route directives must name a fixed service:port, not one resolved at request time.`;
  }
  const { network, host, port } = upstreamEndpoint(address);
  if (network?.startsWith("unix")) {
    return `Upstream ${quoted} is a Unix socket: route directives can only proxy to your services over the network.`;
  }
  if (includesAdminPort(port)) {
    return `Upstream ${quoted} targets port ${CADDY_ADMIN_PORT}, Caddy's admin API: route directives cannot reach it.`;
  }
  return hostReachError(host, quoted);
}

/** Why a filesystem path may not be used by a route directive, or null. */
export function filePathReachError(path: string, what: string): string | null {
  const quoted = JSON.stringify(path);
  const segments = path.split("/");
  const confined =
    !path.includes("{") &&
    !segments.includes("..") &&
    (!path.startsWith("/") ||
      path === DIRECTIVE_FILE_ROOT ||
      path.startsWith(`${DIRECTIVE_FILE_ROOT}/`));
  if (confined) return null;
  return `${what} ${quoted} is outside ${DIRECTIVE_FILE_ROOT}: route directives can only use files under ${DIRECTIVE_FILE_ROOT}, never Caddy's config (/etc/caddy), certificates (/data) or the rest of the edge host.`;
}

/** `{file./path}` placeholders read a file at request time. */
function filePlaceholderError(token: string): string | null {
  for (const match of token.matchAll(/\{file\.([^}]*)\}?/g)) {
    const error = filePathReachError(match[1] ?? "", "The {file.*} placeholder");
    if (error) return error;
  }
  return null;
}

/** Directives that have no safe form inside a route. */
function forbiddenDirectiveError(name: string): string | null {
  if (name === "import") {
    return "import is not allowed in route directives: it would read files (or snippets) from the edge host. Write the directives out in full.";
  }
  if (name === "acme_server") {
    return "acme_server is not allowed in route directives: it would issue certificates from the edge's own CA.";
  }
  return null;
}

/** An `http(s)://` URL argument: what tls subdirectives (`get_certificate
 *  http`, an issuer's `dir`/`ca`) fetch from. */
function isHttpUrl(arg: string): boolean {
  return /^https?:\/\//i.test(arg);
}

/** Every address a directive line dials: upstreams and their `to`, an active
 *  health check's `health_upstream`, an http transport's `forward_proxy_url`,
 *  a log's `output net` sink, and the URLs a `tls` block fetches. */
function lineUpstreams({ tokens, parents }: DirectiveLine): string[] {
  const [name = "", ...args] = tokens;
  const parent = parents.at(-1) ?? "";
  if (UPSTREAM_DIRECTIVES.has(name)) return withoutMatcher(args);
  if ((name === "to" || name === "health_upstream") && UPSTREAM_DIRECTIVES.has(parent)) {
    return args;
  }
  if (name === "forward_proxy_url" && parents.some((p) => UPSTREAM_DIRECTIVES.has(p))) {
    return args;
  }
  if (name === "output" && args[0] === "net" && parents.includes("log")) return args.slice(1, 2);
  if (name === "tls" || parents.includes("tls")) return args.filter(isHttpUrl);
  return [];
}

/** Every value a dynamic upstream source names (`dynamic a <name> <port>`,
 *  or its block forms, which `multi` can nest a level deeper). */
function dynamicUpstreamValues({ tokens, parents }: DirectiveLine): string[] {
  const [name = "", ...args] = tokens;
  if (name === "dynamic" && UPSTREAM_DIRECTIVES.has(parents.at(-1) ?? "")) return args.slice(1);
  return parents.includes("dynamic") ? args : [];
}

function upstreamsError(line: DirectiveLine): string | null {
  for (const upstream of lineUpstreams(line)) {
    const error = upstreamReachError(upstream);
    if (error) return error;
  }
  const reached = dynamicUpstreamValues(line).find(
    (value) =>
      includesAdminPort(value) ||
      isLoopbackHost(value) ||
      isLinkLocalHost(value) ||
      platformHostError(value) !== null,
  );
  return reached === undefined
    ? null
    : `Dynamic upstream ${JSON.stringify(reached)} reaches the edge or the platform itself (loopback, link-local, port ${CADDY_ADMIN_PORT}, or an otterdeploy container): route directives can only proxy to your services.`;
}

/**
 * Every address the directive text dials, as written: static upstreams and the
 * other sinks lineUpstreams reads, plus a dynamic `a` source's `<name>:<port>`
 * and a dynamic block's `name`. The server holds these to the project-aware
 * rules (packages/api/src/caddy/directive-scope.ts) the text alone cannot
 * decide: whose service a name is, and where a DNS name points.
 */
export function customDirectiveUpstreams(text: string): string[] {
  const upstreams: string[] = [];
  for (const line of lexDirectives(text).lines) {
    upstreams.push(...lineUpstreams(line));
    const [name = "", ...args] = line.tokens;
    const parent = line.parents.at(-1) ?? "";
    if (name === "dynamic" && args[0] === "a" && UPSTREAM_DIRECTIVES.has(parent) && args[1]) {
      upstreams.push(`${args[1]}:${args[2] ?? ""}`);
    }
    if (name === "name" && parent === "dynamic" && args[0]) upstreams.push(args[0]);
  }
  return upstreams;
}

/**
 * Whether the text uses the `metrics` directive. It serves Prometheus metrics
 * for EVERY site on the install, not just this route's, so it is an
 * installation administrator's decision; the save handler checks
 * the actor's role before letting it through.
 */
export function hasMetricsDirective(text: string): boolean {
  return lexDirectives(text).lines.some((line) => line.tokens[0] === "metrics");
}

/** Every filesystem path a directive line names. */
function filesError({ tokens, parents }: DirectiveLine): string | null {
  const [name = "", ...args] = tokens;
  // `root [<matcher>] <path>` at site level, `root <path>` inside file_server,
  // templates or a fastcgi transport: either way the path is the last token
  // (a lone `/data` is the path, not a matcher). `vars root <path>` sets the
  // same var `root` compiles to, which file_server reads by default.
  const root =
    name === "root" ? args.at(-1) : name === "vars" && args[0] === "root" ? args[1] : undefined;
  if (root !== undefined) return filePathReachError(root, "root");
  // Certificate/key files (`tls <cert> <key>`, `load`, `ca_root`, client_auth
  // trust files) are paths on the edge host too.
  if (name === "tls" || parents.includes("tls")) {
    const paths = args.filter((arg) => arg.startsWith("/") || arg.startsWith("."));
    const error = paths.map((path) => filePathReachError(path, "tls file")).find(Boolean);
    if (error) return error;
  }
  if (name === "output" && args[0] === "file" && args[1] !== undefined && parents.includes("log")) {
    return filePathReachError(args[1], "log file");
  }
  return null;
}

function lineReachError(line: DirectiveLine): string | null {
  for (const token of line.tokens) {
    const error = filePlaceholderError(token);
    if (error) return error;
  }
  return forbiddenDirectiveError(line.tokens[0] ?? "") ?? upstreamsError(line) ?? filesError(line);
}

/**
 * The first reason this directive text reaches past the route it belongs to,
 * or null when every directive stays within it.
 */
export function customDirectivesReachError(text: string): string | null {
  // Caddy substitutes {$VAR} into the raw text BEFORE lexing it, so an env
  // value could reshape the very tokens checked below; and neither it nor the
  // runtime {env.*} placeholder has a legitimate use here (routes cannot set
  // the edge's environment), only a way to read it.
  if (/\{\$|\{env\./.test(text)) {
    return "Environment placeholders ({$VAR}, {env.*}) are not allowed in route directives: they read the edge's own environment.";
  }
  for (const line of lexDirectives(text).lines) {
    const error = lineReachError(line);
    if (error) return error;
  }
  return null;
}
