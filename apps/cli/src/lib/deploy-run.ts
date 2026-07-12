/**
 * The one save→diff→confirm→apply→report pipeline shared by `deploy`,
 * `sync`, and `up` — single semantics so the three verbs can't drift.
 *
 *   save (expectedVersion from manifest.get) → diff →
 *   dry-run? print plan and stop →
 *   deletes pending? confirm (skipped under --yes/--json) →
 *   applyChange → report applied/skipped →
 *   --wait? follow the changed services' deployments to running.
 */

import { consola } from "consola";

import type { CliClient } from "./resolve";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";
import { countByKind, printDiff } from "./diff-printer";
import { type WaitOutcome, type WaitTarget, waitForDeployments } from "./wait";

export interface RunDeployOptions {
  config?: string;
  env?: string;
  url?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  wait?: boolean;
  timeoutMinutes?: number;
  /** Reuse an already-authenticated client (up's scaffold phase has one). */
  client?: CliClient;
}

export function parseTimeoutMinutes(raw: string | undefined): number {
  if (raw === undefined) return 30;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    consola.error(`--timeout expects a positive number of minutes, got "${raw}".`);
    process.exit(1);
  }
  return minutes;
}

export async function runDeploy(opts: RunDeployOptions): Promise<void> {
  let client = opts.client;
  if (!client) {
    const { url, token } = await ensureAuthenticated(opts.url);
    client = createCliClient({ url, token });
  }

  const manifest = await loadConfig(opts.config);
  const project = await client.project.getBySlug({ slug: manifest.project });
  const current = await client.project.manifest.get({ id: project.id });

  // Save first so the server diff compares the LOCAL manifest against
  // live state; applyChange then uses the bumped version.
  const saved = await client.project.manifest.save({
    projectId: project.id,
    manifest,
    expectedVersion: current.version,
  });
  const diff = await client.project.manifest.diff({
    projectId: project.id,
    environment: opts.env,
  });

  if (opts.dryRun) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
      return;
    }
    printDiff(diff.changes);
    consola.info(`Saved manifest v${saved.version}. Re-run without --dry-run to apply.`);
    return;
  }

  // Destructive changes get one confirmation; skipped under --yes/--json
  // (script-friendly).
  if (!opts.yes && !opts.json) {
    const deletes = countByKind(diff.changes).delete ?? 0;
    if (deletes > 0) {
      printDiff(diff.changes);
      const ok = await consola.prompt(`${deletes} resource(s) will be deleted. Continue?`, {
        type: "confirm",
        initial: false,
      });
      if (!ok) {
        consola.info("Aborted.");
        process.exit(1);
      }
    }
  }

  // Capture wait targets from the diff BEFORE apply — applyChange's
  // output doesn't identify which resources changed.
  const waitNames = opts.wait
    ? diff.changes
        .filter((c) => c.resource === "service" && (c.kind === "create" || c.kind === "update"))
        .map((c) => c.name)
    : [];

  if (!opts.json) consola.info(`Applying${opts.env ? ` (env: ${opts.env})` : ""}…`);

  const result = await client.project.manifest.applyChange({
    projectId: project.id,
    manifest,
    expectedVersion: saved.version,
    environment: opts.env,
  });

  if (!opts.json) {
    consola.success(`Applied ${result.appliedCount} change(s) (manifest v${result.version}).`);
    if (result.skipped.length > 0) {
      consola.warn("Skipped:");
      for (const s of result.skipped) {
        consola.log(`  ${s.resource} ${s.name}: ${s.reason}`);
      }
    }
  }
  if (result.skipped.length > 0) process.exitCode = 1;

  let waitOutcomes: WaitOutcome[] = [];
  if (opts.wait) {
    const targets = await resolveWaitTargets(client, project.id, waitNames);
    if (targets.length === 0) {
      if (!opts.json) consola.info("No changed services to wait on.");
    } else {
      const { ok, outcomes } = await waitForDeployments({
        client,
        projectId: project.id,
        targets,
        timeoutMs: (opts.timeoutMinutes ?? 30) * 60_000,
        json: opts.json,
      });
      waitOutcomes = outcomes;
      if (!ok) process.exitCode = 1;
    }
  }

  if (opts.json) {
    const payload = opts.wait ? { ...result, wait: waitOutcomes } : result;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

async function resolveWaitTargets(
  client: CliClient,
  projectId: string,
  names: string[],
): Promise<WaitTarget[]> {
  if (names.length === 0) return [];
  const wanted = new Set(names);
  const resources = await client.project.resource.list({ projectId });
  return resources
    .filter((r) => r.type === "service" && wanted.has(r.name))
    .map((r) => ({ resourceId: r.resourceId, name: r.name }));
}
