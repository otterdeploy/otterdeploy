/**
 * Connection probing: can this URL (or saved connection) actually be opened?
 *
 * Split from connections.ts so the handler factory there stays within the lint
 * budget. Everything here is read-only by construction — a probe must never be
 * a way to acquire a writable session on a database it is only testing.
 */
import { displayText } from "@otterdeploy/data-engine";
import { env } from "@otterdeploy/env/server";
import { Result } from "better-result";

import type { ParsedConnectionUrl } from "../../data/connection-url";

import { requirePermission } from "../..";
import { connect, execute, parseConnectionUrl } from "../../data";

/**
 * Whether this instance may connect to private addresses.
 *
 * Off unless the operator turns it on. Someone running otterdeploy alongside a
 * database on the same host is a real case, but it has to be an instance-level
 * decision — otherwise any member could reach the metadata service or another
 * tenant's overlay address by pasting a URL.
 */
export function allowsPrivateAddresses(): boolean {
  return env.DATA_ALLOW_PRIVATE_CONNECTIONS === true;
}

/**
 * A throwaway read-only target for a URL that exists only in this request.
 *
 * Keyed by a HASH of the whole URL: the same credential re-tested reuses the
 * client, a corrected password gets a fresh one, and the key itself never
 * holds anything reversible.
 */
function draftTarget(url: string, p: ParsedConnectionUrl): Parameters<typeof connect>[0] {
  return {
    poolKey: `testurl:${Bun.hash(url).toString(36)}`,
    engine: p.engine,
    host: p.host,
    port: p.port,
    database: p.database,
    username: p.username,
    password: p.password,
    tls: p.sslRequested,
    mode: "read-only",
    writeAllowed: false,
    resourceId: null,
    connectionId: null,
    label: "connection test",
  };
}

/** Open the connection once and read the server's version string. */
export async function probeVersion(target: Parameters<typeof connect>[0]) {
  const connection = connect(target);
  const startedAt = performance.now();
  const grid = await execute(connection, { sql: "SELECT version()", params: [] });
  if (grid.isErr()) return grid;
  const cell = grid.value.rows[0]?.[0];
  return Result.ok({
    durationMs: Math.round(performance.now() - startedAt),
    serverVersion: cell === null || cell === undefined ? "" : displayText(cell),
  });
}

/** Test a URL that is not (or not yet) a saved connection. */
export const testUrlHandler = requirePermission({ database: ["read"] }).data.testUrl.handler(
  async ({ input, context, errors }) => {
    // Deliberately WITHOUT the URL: it carries a live credential, and the log
    // line only needs to say a test happened.
    context.log.set({ dataConnection: { testUrl: true } });
    const parsed = parseConnectionUrl(input.url, {
      allowPrivateAddresses: allowsPrivateAddresses(),
    });
    if (parsed.isErr()) {
      throw errors.INVALID_URL({ data: { reason: parsed.error.message } });
    }
    const probe = await probeVersion(draftTarget(input.url, parsed.value));
    if (probe.isErr()) {
      throw errors.UNREACHABLE({ data: { reason: probe.error.message } });
    }
    return { ok: true, engine: parsed.value.engine, ...probe.value };
  },
);
