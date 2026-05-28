import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";
import { printDiff } from "../lib/diff-printer";

// `preview` is the read-only sibling of `sync` — saves the manifest so
// the server-side diff has fresh state, but never applies. Cheap and
// idempotent; safe to run on every commit in CI.
export const previewCommand = defineCommand({
  meta: {
    name: "preview",
    description: "Show what changes would be applied (no apply)",
  },
  args: {
    config: { type: "string", description: "Path to config file" },
    env: { type: "string", description: "Target a specific environment" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const manifest = await loadConfig(args.config);
    const project = await client.project.getBySlug({ slug: manifest.project });

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

    if (args.json) {
      process.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
      return;
    }
    printDiff(diff.changes);
    consola.info(`Saved manifest v${saved.version}.`);
  },
});
