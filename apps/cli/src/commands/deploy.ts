import { defineCommand } from "citty";
import { consola } from "consola";

import { createCliClient } from "../client";
import { resolveToken, resolveUrl } from "../config";
import { loadManifestFile } from "../manifest-file";

export const deployCommand = defineCommand({
  meta: {
    name: "deploy",
    description: "Save the local otterstack.json and reconcile resources",
  },
  args: {
    env: { type: "string", description: "Environment override block to apply" },
    "dry-run": { type: "boolean", description: "Show the change plan without applying" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const url = resolveUrl(args.url);
    const token = resolveToken();
    if (!url || !token) {
      consola.error("Not logged in. Run `otterdeploy login <url>`.");
      process.exit(1);
    }
    const client = createCliClient({ url, token });

    const manifest = loadManifestFile();

    // Resolve project slug → id (CLI addresses by slug; server takes id).
    const project = await client.project.getBySlug({ slug: manifest.project });

    // Always save first — the apply path reads the saved manifest, so
    // unsaved local edits would otherwise be ignored.
    const current = await client.project.manifest.get({ id: project.id });
    const saved = await client.project.manifest.save({
      projectId: project.id,
      manifest,
      expectedVersion: current.version,
    });

    if (args["dry-run"]) {
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

    consola.info(`Saved manifest v${saved.version}. Applying${args.env ? ` (env: ${args.env})` : ""}…`);

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

function printDiff(changes: Array<{ kind: string; resource: string; name: string; details?: unknown }>) {
  if (changes.length === 0) {
    consola.info("No changes.");
    return;
  }
  for (const c of changes) {
    const symbol = c.kind === "create" ? "+" : c.kind === "delete" ? "-" : c.kind === "update" ? "~" : "·";
    consola.log(`  ${symbol} ${c.resource.padEnd(8)} ${c.name}`);
    if (c.details) {
      const summary = JSON.stringify(c.details);
      if (summary.length < 200) consola.log(`      ${summary}`);
    }
  }
}
