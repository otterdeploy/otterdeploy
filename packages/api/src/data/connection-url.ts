import {
  isForbiddenEgressAddress,
  resolveEgressAddresses,
} from "@otterdeploy/shared/egress-policy";
import { errorFromUnknown } from "@otterdeploy/shared/promise";
import { Result, TaggedError } from "better-result";
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
import { isIP } from "node:net";

/**
 * Engines an external URL can name.
 *
 * Narrower than `DatabaseEngine` on purpose: these are the ones with a wire
 * driver, so the type makes "saved a connection we cannot open" unrepresentable
 * rather than a runtime failure on first use.
 */
export type ConnectableEngine = "postgres" | "mariadb";

class ConnectionUrlError extends TaggedError("ConnectionUrlError")<{
  reason: "malformed" | "unsupported_scheme" | "blocked_host" | "missing_database";
  message: string;
}>() {}

type ConnectionUrlErrorReason = ConnectionUrlError["reason"];

function urlError(reason: ConnectionUrlErrorReason, message: string): ConnectionUrlError {
  return new ConnectionUrlError({ reason, message });
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
    catch: () => urlError("malformed", "that does not look like a database URL"),
  });
  if (parsed.isErr()) return Result.err(parsed.error);
  const url = parsed.value;

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  const known = SCHEMES[scheme];
  if (!known) {
    return Result.err(
      urlError(
        "unsupported_scheme",
        `"${scheme}://" is not a database the workbench can open; use postgres:// or mysql://`,
      ),
    );
  }

  const host = url.hostname;
  if (host === "") {
    return Result.err(urlError("malformed", "the URL has no host"));
  }
  if (!options.allowPrivateAddresses) {
    const literal = host.replace(/^\[|\]$/g, "");
    if (
      BLOCKED_HOSTNAMES.has(host.toLowerCase()) ||
      (isIP(literal) !== 0 && isForbiddenEgressAddress(literal))
    ) {
      return Result.err(
        urlError(
          "blocked_host",
          `${host} is a loopback, private or metadata address. The control plane can reach things there that are not yours to browse, so external connections must name a public host.`,
        ),
      );
    }
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database === "") {
    return Result.err(urlError("missing_database", "the URL does not name a database"));
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

export interface ResolvedConnectionAddress {
  /** Address checked immediately before connect; use this instead of resolving again. */
  address: string;
  /** Original hostname for TLS SNI and certificate verification. */
  serverName: string | null;
}

/**
 * Resolve and validate every DNS answer, then pin one checked address.
 *
 * Checking only the hostname text misses a public name that resolves to
 * loopback/private space. Connecting by name after a separate lookup also
 * leaves a DNS-rebinding window, so callers connect to `address` and retain the
 * original hostname only as TLS `serverName`.
 */
export async function resolveConnectionAddress(
  host: string,
  options: ParseOptions = {},
): Promise<Result<ResolvedConnectionAddress, ConnectionUrlError>> {
  const literal = host.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(literal);
  const urlHost = literalFamily === 6 ? `[${literal}]` : literal;
  const allowAddresses = options.allowPrivateAddresses ? ["0.0.0.0/0", "::/0"] : undefined;
  const resolved = await Result.tryPromise({
    try: () => resolveEgressAddresses(new URL(`https://${urlHost}`), { allowAddresses }),
    catch: (cause) =>
      urlError(
        isForbiddenEgressAddress(literal, { allowAddresses }) ? "blocked_host" : "malformed",
        `could not use database host ${host}: ${errorFromUnknown(cause).message}`,
      ),
  });
  if (resolved.isErr()) return Result.err(resolved.error);
  return Result.ok({
    address: resolved.value[0].address,
    serverName: literalFamily === 0 ? literal : null,
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
