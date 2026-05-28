import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";
import { printDiff } from "../lib/diff-printer";

export const deployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Save the local config and reconcile resources",
  },
  args: {
    config: { type: "string", description: "Path to config file" },
    env: { type: "string", description: "Environment override block to apply" },
    "dry-run": { type: "boolean", description: "Show the change plan without applying" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const manifest = await loadConfig(args.config);
    const project = await client.project.getBySlug({ slug: manifest.project });
    const current = await client.project.manifest.get({ id: project.id });

    // Dry-run path: save + diff, then bail. Same shape as `sync --preview`.
    if (args["dry-run"]) {
      const saved = await client.project.manifest.save({
        projectId: project.id,
        manifest,
        expectedVersion: current.version,
      });
      const diff = await client.project.manifest.diff({
        projectId: project.id,
        environment: args.env,
      });
      if (args.json) {
        process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
        return;
      }
      printDiff(diff.changes);
      consola.info(`Saved manifest v${saved.version}. Re-run without --dry-run to apply.`);
      return;
    }

    consola.info(`Applying${args.env ? ` (env: ${args.env})` : ""}…`);

    // One RPC — same path UI Deploy uses.
    const result = await client.project.manifest.applyChange({
      projectId: project.id,
      manifest,
      expectedVersion: current.version,
      environment: args.env,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    consola.success(`Applied ${result.appliedCount} change(s) (manifest v${result.version}).`);
    if (result.skipped.length > 0) {
      consola.warn("Skipped:");
      for (const s of result.skipped) {
        consola.log(`  ${s.resource} ${s.name}: ${s.reason}`);
      }
      process.exitCode = 1;
    }
  },
});
