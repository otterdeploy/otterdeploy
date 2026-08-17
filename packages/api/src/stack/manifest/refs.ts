/**
 * Reference grammar for manifest env-var values.
 *
 *   ${secret}: value lives server-side; manifest declares presence only
 *   ${database:<name>.<field>}: another database resource's URL/host/port/etc.
 *   ${service:<name>.<KEY>}: another service's env var
 *   ${service:<name>.host}: that service's internal hostname
 *   ${service:<name>.port}: primary published port
 *   ${service:<name>.port.<name>}, named published port
 *
 * Strings may interpolate refs in the middle of a value, e.g.
 *   "postgres://acme:${database:primary.password}@${database:primary.host}:5432/acme"
 *
 * Phase 3 parses + classifies; Phase 4 will resolve them server-side at apply.
 */

import { TaggedError } from "better-result";

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

type DatabaseField = Extract<Ref, { kind: "database" }>["field"];

const DATABASE_FIELDS: ReadonlySet<string> = new Set([
  "url",
  "host",
  "port",
  "username",
  "password",
  "database",
] satisfies DatabaseField[]);

/** True when `value` names a database ref field. The set is built from the
 *  `DatabaseField` list (checked by `satisfies`), so the guard is honest. */
function isDatabaseField(value: string): value is DatabaseField {
  return DATABASE_FIELDS.has(value);
}

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
    // `${{…}}` is the PLATFORM reference grammar (`${{postgres.DATABASE_URL}}`,
    // `${{vault.<provider>.<key>}}`), resolved at deploy time by the variable
    // resolver — not a manifest ref. The single-brace regex captures it as
    // `{…` (stopping at the first `}`), which used to throw "Unknown
    // reference" and reject any staged env row that carried a reference
    // token. Treat it as opaque text instead.
    if (body.startsWith("{")) continue;
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
    if (!isDatabaseField(tail)) {
      throw new ManifestRefError(
        `Unknown database field "${tail}" in \${${body}}. Expected one of ${[...DATABASE_FIELDS].join(", ")}.`,
      );
    }
    return { kind: "database", name, field: tail };
  }

  if (namespace === "service") {
    if (tail === "host") return { kind: "service", name, field: "host" };
    if (tail === "port") return { kind: "service", name, field: "port" };
    if (tail.startsWith("port.")) {
      return { kind: "service", name, field: "port", portName: tail.slice("port.".length) };
    }
    // Anything else is treated as an env-var key, by convention upper-snake.
    return { kind: "service-env", name, key: tail };
  }

  throw new ManifestRefError(`Unknown reference namespace "${namespace}" in \${${body}}.`);
}

export class ManifestRefError extends TaggedError("ManifestRefError")<{
  message: string;
}>() {
  constructor(message: string) {
    super({ message });
  }
}
