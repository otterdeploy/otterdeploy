import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";
import { countByKind, printDiff } from "../lib/diff-printer";

// `status` differs from `preview` in one important way: it doesn't
// write the manifest. It diffs the local config against the server's
// CURRENT state, so it surfaces drift introduced through the UI or
// other CLI sessions. Exits non-zero when drift is detected so it's
// usable in CI as a "did anyone change anything?" gate.
export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show current state vs config drift",
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

    if (args.json) {
      const diff = await client.project.manifest.diff({
        projectId: project.id,
        environment: args.env,
      });
      process.stdout.write(
        `${JSON.stringify(
          {
            localVersion: "<computed-on-sync>",
            serverVersion: current.version,
            inSync: JSON.stringify(current.manifest) === JSON.stringify(manifest),
            changesIfSynced: diff.changes,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const localBlob = JSON.stringify(manifest);
    const serverBlob = JSON.stringify(current.manifest);
    consola.info(`Server manifest version: v${current.version}`);

    if (localBlob === serverBlob) {
      consola.success("Local config matches server manifest exactly.");
    } else if (current.manifest === null) {
      consola.warn("Server has no saved manifest yet — first `sync` will publish the local config.");
    } else {
      consola.warn("Local config and server manifest differ. Run `preview` to see what `sync` would change.");
    }

    // Independently, surface drift in the running RESOURCES vs the
    // current server manifest — meaning a delete or update done via
    // the UI since the last apply.
    const diff = await client.project.manifest.diff({
      projectId: project.id,
      environment: args.env,
    });
    const meaningful = diff.changes.filter((c) => c.kind !== "no-op");
    if (meaningful.length === 0) {
      consola.success("Resources match the manifest.");
      return;
    }
    consola.warn("Resources drift from manifest:");
    printDiff(meaningful);
    const counts = countByKind(meaningful);
    if (counts.delete || counts.create || counts.update) process.exitCode = 1;
  },
});
