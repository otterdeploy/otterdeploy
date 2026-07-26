/**
 * od-5j8.11 — a node that joins without host-firewall configuration is
 * detected as drifted, not silently reported as "protected".
 *
 * The platform tracks per-server firewall provisioning state in a persisted
 * DB column (server.firewall_status), not a live re-probe — see
 * docs/designs/vps-firewall-layering.md §Drift detection for why (no
 * ongoing SSH/host channel exists to swarm-joined nodes; see ssh-exec.ts's
 * own module note: "once a node is in the swarm it's managed through the
 * manager socket, never through here"). Invariants under test:
 *
 *   1. The DB default for every server row is `firewall_status = 'unknown'`
 *      — so a node that predates this feature, or whose provisioning run
 *      skipped/never reached the firewall step, reads as UNPROTECTED, never
 *      as a false "applied".
 *   2. `isFirewallDrifted` (the classifier the UI/remediation path would
 *      read) treats that default as drift.
 *   3. The provisioning runner actually records the firewall outcome on
 *      EVERY join — both the full-provision path and the firewall-only
 *      remediation path — via `patchServerFirewall`, so drift is knowable
 *      instead of the DB silently keeping the "unknown" default forever.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vite-plus/test";

import { isFirewallDrifted } from "../../routers/server/host-firewall";

const repositoryRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

describe("[od-5j8.11] DB default is honest about an un-firewalled node", () => {
  test("server.firewall_status defaults to 'unknown', not 'applied'", () => {
    const schema = source("packages/db/src/schema/server.ts");
    expect(schema).toContain(
      'firewallStatus: serverFirewallStatusEnum("firewall_status").notNull().default("unknown")',
    );
  });

  test("server.firewall_bouncer_active defaults to false", () => {
    const schema = source("packages/db/src/schema/server.ts");
    expect(schema).toContain(
      'firewallBouncerActive: boolean("firewall_bouncer_active").notNull().default(false)',
    );
  });

  test("the generated migration is additive only (no destructive rewrite of existing server rows)", () => {
    // The migration folder name is timestamped/random; find it by content.
    const migrationsDir = resolve(repositoryRoot, "packages/db/src/migrations");
    const dirs = readdirSync(migrationsDir).filter((d) => !d.startsWith(".") && d !== "meta");
    const match = dirs.find((d) => {
      const file = join(migrationsDir, d, "migration.sql");
      return existsSync(file) && readFileSync(file, "utf8").includes("firewall_status");
    });
    expect(match, "no migration adds firewall_status").toBeDefined();
    const sql = readFileSync(join(migrationsDir, match as string, "migration.sql"), "utf8");
    expect(sql).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE/i);
    expect(sql).toContain("ADD COLUMN");
  });

  test("a row at the DB default classifies as drifted", () => {
    expect(isFirewallDrifted({ firewallStatus: "unknown", firewallBouncerActive: false })).toBe(
      true,
    );
  });
});

describe("[od-5j8.11] every join path records the firewall outcome (so drift is knowable)", () => {
  test("the full provisioning path calls installHostFirewall and persists the result via patchServerFirewall", () => {
    const runner = source("packages/api/src/routers/server/provision-runner.ts");
    expect(runner).toContain("installHostFirewall(");
    expect(runner).toContain("patchServerFirewall({");
  });

  test("the full path delegates to runFirewallOnlyJob for remediation runs", () => {
    const runner = source("packages/api/src/routers/server/provision-runner.ts");
    expect(runner).toContain("if (payload.firewallOnly)");
    expect(runner).toContain("await runFirewallOnlyJob(payload);");
  });

  test("the firewall-only remediation path (drift repair) also persists via patchServerFirewall", () => {
    const remediation = source("packages/api/src/routers/server/firewall-remediation.ts");
    const fn = remediation.slice(remediation.indexOf("export async function runFirewallOnlyJob"));
    expect(fn).toContain("installHostFirewall(");
    expect(fn).toContain("patchServerFirewall({");
  });

  test("a thrown error in the firewall-only path still records firewallStatus: \"failed\" (never silently drops the attempt)", () => {
    const remediation = source("packages/api/src/routers/server/firewall-remediation.ts");
    const fn = remediation.slice(remediation.indexOf("export async function runFirewallOnlyJob"));
    const catchBlock = fn.slice(fn.indexOf("} catch (err) {"));
    expect(catchBlock).toContain('firewallStatus: "failed"');
  });

  test("remediation requires a stored managed SSH key — a password-bootstrapped node with no stored key is refused, not silently no-op'd", () => {
    const handlers = source("packages/api/src/routers/server/handlers.ts");
    const fn = handlers.slice(
      handlers.indexOf("export async function reapplyFirewall"),
      handlers.indexOf("export async function retryProvision"),
    );
    expect(fn).toContain("if (!existing.sshKeyId)");
    expect(fn).toContain("ProvisionMissingCredentialError");
  });
});
