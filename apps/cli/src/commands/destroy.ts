import { defineCommand } from "citty";
import { consola } from "consola";

import type { Manifest } from "@otterstack/api/manifest";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";

// `destroy` is sync against an empty manifest — the reconciler will
// emit deletes for every service + database, and the project ends up
// resource-free. The config file on disk is untouched (terraform-style:
// `destroy` doesn't delete your .tf files), so a subsequent `sync`
// would recreate the same shape.
export const destroyCommand = defineCommand({
  meta: {
    name: "destroy",
    description: "Remove all resources defined in config",
  },
  args: {
    config: { type: "string", description: "Path to config file" },
    env: { type: "string", description: "Target a specific environment" },
    yes: { type: "boolean", description: "Skip confirmation prompts" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const manifest = await loadConfig(args.config);
    const serviceCount = Object.keys(manifest.services).length;
    const databaseCount = Object.keys(manifest.databases).length;

    if (!args.yes && !args.json) {
      const ok = await consola.prompt(
        `This will delete ${serviceCount} service(s) and ${databaseCount} database(s) from project "${manifest.project}". Continue?`,
        { type: "confirm", initial: false },
      );
      if (!ok) {
        consola.info("Aborted.");
        process.exit(1);
      }
    }

    const project = await client.project.getBySlug({ slug: manifest.project });

    const current = await client.project.manifest.get({ id: project.id });
    const empty: Manifest = {
      $schema: manifest.$schema,
      version: 1,
      project: manifest.project,
      services: {},
      databases: {},
      environments: manifest.environments,
    };

    await client.project.manifest.save({
      projectId: project.id,
      manifest: empty,
      expectedVersion: current.version,
    });

    const result = await client.project.manifest.apply({
      projectId: project.id,
      environment: args.env,
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    consola.success(`Removed ${result.appliedCount} resource(s).`);
    if (result.skipped.length > 0) {
      consola.warn("Skipped:");
      for (const s of result.skipped) {
        consola.log(`  ${s.resource} ${s.name}: ${s.reason}`);
      }
      process.exitCode = 1;
    }
  },
});
