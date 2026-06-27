import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";
import { countByKind, printDiff } from "../lib/diff-printer";

export const syncCommand = defineCommand({
  meta: {
    name: "sync",
    description: "Load config and reconcile resources to match",
  },
  args: {
    config: { type: "string", description: "Path to config file" },
    env: { type: "string", description: "Target a specific environment" },
    preview: { type: "boolean", description: "Diff only, do not apply" },
    yes: { type: "boolean", description: "Skip confirmation prompts" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const manifest = await loadConfig(args.config);
    const project = await client.project.getBySlug({ slug: manifest.project });
    const current = await client.project.manifest.get({ id: project.id });

    // Preview path: save + diff, but skip apply. Lets users see what
    // `sync` would do without committing. The save still happens so the
    // server's diff sees the latest manifest — preview is also the
    // canonical way to publish a draft for the UI to inspect.
    if (args.preview) {
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
      consola.info(`Saved manifest v${saved.version}. Re-run without --preview to apply.`);
      return;
    }

    // Confirmation path: if there's a destructive change pending (any
    // delete), surface the diff and prompt before applying. Skipped
    // under --yes / --json (script-friendly).
    if (!args.yes && !args.json) {
      const diff = await client.project.manifest.diff({
        projectId: project.id,
        environment: args.env,
      });
      const counts = countByKind(diff.changes);
      if ((counts.delete ?? 0) > 0) {
        printDiff(diff.changes);
        const ok = await consola.prompt(`${counts.delete} resource(s) will be deleted. Continue?`, {
          type: "confirm",
          initial: false,
        });
        if (!ok) {
          consola.info("Aborted.");
          process.exit(1);
        }
      }
    }

    // One RPC — atomic save+apply. Same path the UI Deploy button uses.
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
