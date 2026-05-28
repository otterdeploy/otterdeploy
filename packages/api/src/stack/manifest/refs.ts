/**
 * Reference grammar for manifest env-var values.
 *
 *   ${secret}                       — value lives server-side; manifest declares presence only
 *   ${database:<name>.<field>}      — another database resource's URL/host/port/etc.
 *   ${service:<name>.<KEY>}         — another service's env var
 *   ${service:<name>.host}          — that service's internal hostname
 *   ${service:<name>.port}          — primary published port
 *   ${service:<name>.port.<name>}   — named published port
 *
 * Strings may interpolate refs in the middle of a value, e.g.
 *   "postgres://acme:${database:primary.password}@${database:primary.host}:5432/acme"
 *
 * Phase 3 parses + classifies; Phase 4 will resolve them server-side at apply.
 */

export type Ref =
  | { kind: "secret" }
  | {
      kind: "database";
      name: string;
      field: "url" | "host" | "port" | "username" | "password" | "database";
    }
  | { kind: "service"; name: string; field: "host" }
  | { kind: "service"; name: string; field: "port"; portName?: string }
  | { kind: "service-env"; name: string; key: string };

const REF_PATTERN = /\$\{([^}]+)\}/g;

const DATABASE_FIELDS = new Set([
  "url",
  "host",
  "port",
  "username",
  "password",
  "database",
]);

export function isSecretSentinel(value: string): boolean {
  return value.trim() === "${secret}";
}

/**
 * Parse every `${…}` token in a value. Returns an empty array for plain
 * strings; one `secret` entry for the sentinel; one or more typed refs for
 * interpolated values. Throws on a malformed token so the manifest fails
 * validation early instead of at deploy time.
 */
export function parseRefs(value: string): Ref[] {
  const refs: Ref[] = [];
  for (const match of value.matchAll(REF_PATTERN)) {
    const body = match[1];
    if (body === undefined) continue;
    refs.push(parseToken(body));
  }
  return refs;
}

function parseToken(body: string): Ref {
  if (body === "secret") return { kind: "secret" };

  const colonIdx = body.indexOf(":");
  if (colonIdx === -1) {
    throw new ManifestRefError(`Unknown reference: \${${body}}`);
  }
  const namespace = body.slice(0, colonIdx);
  const rest = body.slice(colonIdx + 1);
  const dotIdx = rest.indexOf(".");
  if (dotIdx === -1) {
    throw new ManifestRefError(`Reference missing field: \${${body}}`);
  }
  const name = rest.slice(0, dotIdx);
  const tail = rest.slice(dotIdx + 1);

  if (namespace === "database") {
    if (!DATABASE_FIELDS.has(tail)) {
      throw new ManifestRefError(
        `Unknown database field "${tail}" in \${${body}}. Expected one of ${[...DATABASE_FIELDS].join(", ")}.`,
      );
    }
    return { kind: "database", name, field: tail as Ref extends { kind: "database" } ? Ref["field"] : never };
  }

  if (namespace === "service") {
    if (tail === "host") return { kind: "service", name, field: "host" };
    if (tail === "port") return { kind: "service", name, field: "port" };
    if (tail.startsWith("port.")) {
      return { kind: "service", name, field: "port", portName: tail.slice("port.".length) };
    }
    // Anything else is treated as an env-var key — by convention upper-snake.
    return { kind: "service-env", name, key: tail };
  }

  throw new ManifestRefError(`Unknown reference namespace "${namespace}" in \${${body}}.`);
}

export class ManifestRefError extends Error {
  override readonly name = "ManifestRefError";
}
