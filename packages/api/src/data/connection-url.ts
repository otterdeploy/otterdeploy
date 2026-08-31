/**
 * Parsing a database URL a human pasted in.
 *
 * Two jobs, and the second is the important one:
 *
 *   1. Pull out host / port / database / user / password so the pool can open a
 *      connection without re-parsing the string every time.
 *   2. REFUSE the URLs that would turn the workbench into an SSRF tool.
 *
 * The control plane sits inside the cluster and can reach the metadata service,
 * the Docker socket's host, other tenants' overlay addresses and localhost. A
 * feature whose whole purpose is "connect to an address the user typed" is the
 * ideal way to reach all of those, so the address is checked here, once, before
 * anything opens a socket.
 */
import { Result, TaggedError } from "better-result";

/**
 * Engines an external URL can name.
 *
 * Narrower than `DatabaseEngine` on purpose: these are the ones with a wire
 * driver, so the type makes "saved a connection we cannot open" unrepresentable
 * rather than a runtime failure on first use.
 */
export type ConnectableEngine = "postgres" | "mariadb";

export class ConnectionUrlError extends TaggedError("ConnectionUrlError")<{
  reason: "malformed" | "unsupported_scheme" | "blocked_host" | "missing_database";
  message: string;
}>() {
  constructor(
    reason: "malformed" | "unsupported_scheme" | "blocked_host" | "missing_database",
    message: string,
  ) {
    super({ reason, message });
  }
}

export interface ParsedConnectionUrl {
  engine: ConnectableEngine;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  /** `sslmode`/`ssl` from the query string, when the URL asked for one. */
  sslRequested: boolean;
}

const SCHEMES: Record<string, { engine: ConnectableEngine; port: number }> = {
  postgres: { engine: "postgres", port: 5432 },
  postgresql: { engine: "postgres", port: 5432 },
  mysql: { engine: "mariadb", port: 3306 },
  mariadb: { engine: "mariadb", port: 3306 },
};

/**
 * Hostnames that are never a legitimate external database.
 *
 * Loopback and the link-local metadata address are the two that matter: the
 * first reaches the control plane's own services, the second is how a cloud
 * instance's credentials get stolen.
 */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  // AWS / GCP / Azure instance metadata.
  "169.254.169.254",
  "metadata.google.internal",
  "metadata",
]);

/**
 * Reserved IPv4 blocks, as `[first octet, predicate on the second]`.
 *
 * A table because each entry is a fact about IPv4, not a branch: the list is
 * what needs reviewing, and reading it as data makes a missing range obvious in
 * a way a chain of `if`s does not.
 */
const RESERVED_V4: ReadonlyArray<readonly [number, (b: number) => boolean]> = [
  [0, () => true], // "this network"
  [10, () => true], // private
  [127, () => true], // loopback
  [100, (b) => b >= 64 && b <= 127], // carrier-grade NAT, used by some meshes
  [169, (b) => b === 254], // link-local — cloud metadata lives here
  [172, (b) => b >= 16 && b <= 31], // private
  [192, (b) => b === 168], // private
];

function isPrivateV4(host: string): boolean | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1, 5).map(Number);
  // A malformed dotted quad is treated as private, i.e. refused. Guessing in
  // the permissive direction here would be guessing about an address we are
  // about to open a socket to.
  if (octets.some((n) => Number.isNaN(n) || n > 255)) return true;
  const [a, b] = octets;
  if (a === undefined || b === undefined) return true;
  return RESERVED_V4.some(([first, rest]) => a === first && rest(b));
}

/** fc00::/7 unique-local, fe80::/10 link-local, plus loopback and unspecified. */
const RESERVED_V6 = /^(::1?$|f[cd]|fe[89ab])/;

/** Private and reserved IPv4 ranges, plus IPv6 loopback/link-local/ULA. */
function isPrivateAddress(host: string): boolean {
  const v4 = isPrivateV4(host);
  if (v4 !== null) return v4;
  return RESERVED_V6.test(host.replace(/^\[|\]$/g, "").toLowerCase());
}

export interface ParseOptions {
  /**
   * Allow private and loopback addresses.
   *
   * Off by default. An operator running otterdeploy on the same host as a
   * database they want to browse is a real case, so this exists — but it has to
   * be a deliberate instance-level choice, not something a URL can opt into by
   * being written a particular way.
   */
  allowPrivateAddresses?: boolean;
}

export function parseConnectionUrl(
  raw: string,
  options: ParseOptions = {},
): Result<ParsedConnectionUrl, ConnectionUrlError> {
  const parsed = Result.try({
    try: () => new URL(raw.trim()),
    catch: () => new ConnectionUrlError("malformed", "that does not look like a database URL"),
  });
  if (parsed.isErr()) return Result.err(parsed.error);
  const url = parsed.value;

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  const known = SCHEMES[scheme];
  if (!known) {
    return Result.err(
      new ConnectionUrlError(
        "unsupported_scheme",
        `"${scheme}://" is not a database the workbench can open; use postgres:// or mysql://`,
      ),
    );
  }

  const host = url.hostname;
  if (host === "") {
    return Result.err(new ConnectionUrlError("malformed", "the URL has no host"));
  }
  if (!options.allowPrivateAddresses) {
    if (BLOCKED_HOSTNAMES.has(host.toLowerCase()) || isPrivateAddress(host)) {
      return Result.err(
        new ConnectionUrlError(
          "blocked_host",
          `${host} is a loopback, private or metadata address. The control plane can reach things there that are not yours to browse, so external connections must name a public host.`,
        ),
      );
    }
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database === "") {
    return Result.err(
      new ConnectionUrlError("missing_database", "the URL does not name a database"),
    );
  }

  const sslParam = url.searchParams.get("sslmode") ?? url.searchParams.get("ssl");
  const sslRequested =
    sslParam !== null && !["disable", "false", "0", "off"].includes(sslParam.toLowerCase());

  return Result.ok({
    engine: known.engine,
    host,
    port: url.port === "" ? known.port : Number(url.port),
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslRequested,
  });
}

/**
 * A label for the connection list that reveals no credential.
 *
 * `user:pass@host` is exactly what must never be shown, so only the host and
 * database survive.
 */
export function describeConnection(parsed: ParsedConnectionUrl): {
  displayHost: string;
  displayDatabase: string;
} {
  return {
    displayHost: parsed.port === 0 ? parsed.host : `${parsed.host}:${parsed.port}`,
    displayDatabase: parsed.database,
  };
}
