import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";
import { countByKind, printDiff } from "../lib/diff-printer";

export const syncCommand = defineCommand({
  meta: {
    name: "sync",
    description: "Load config, diff, and apply changes",
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

    // Save first so the server's diff sees the latest manifest. The
    // expectedVersion gate makes concurrent edits surface as CONFLICT
    // instead of silently overwriting.
    const current = await client.project.manifest.get({ id: project.id });
    const saved = await client.project.manifest.save({
      projectId: project.id,
      manifest,
      expectedVersion: current.version,
    });

    const diff = await client.project.manifest.diff({
      projectId: project.id,
      environment: args.env,
    });

    if (args.preview) {
      if (args.json) {
        process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
        return;
      }
      printDiff(diff.changes);
      consola.info(`Saved manifest v${saved.version}. Re-run without --preview to apply.`);
      return;
    }

    // Confirm before destructive applies (any delete) unless --yes.
    const counts = countByKind(diff.changes);
    if ((counts.delete ?? 0) > 0 && !args.yes && !args.json) {
      printDiff(diff.changes);
      const ok = await consola.prompt(
        `${counts.delete} resource(s) will be deleted. Continue?`,
        { type: "confirm", initial: false },
      );
      if (!ok) {
        consola.info("Aborted.");
        process.exit(1);
      }
    }

    const result = await client.project.manifest.apply({
      projectId: project.id,
      environment: args.env,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    consola.success(`Applied ${result.appliedCount} change(s).`);
    if (result.skipped.length > 0) {
      consola.warn("Skipped:");
      for (const s of result.skipped) {
        consola.log(`  ${s.resource} ${s.name}: ${s.reason}`);
      }
      process.exitCode = 1;
    }
  },
});
