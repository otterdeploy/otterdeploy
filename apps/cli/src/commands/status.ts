import { defineCommand } from "citty";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { loadConfig } from "../config-file";
import { countByKind, printChangeSummary, printDiff } from "../lib/diff-printer";
import { cmd } from "../lib/name";
import { detail, dim, hint, note, ok, out, paint, section, warn } from "../lib/ui";

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
            serverVersion: current.version,
            inSync: JSON.stringify(current.manifest) === JSON.stringify(manifest),
            changes: diff.changes,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const localBlob = JSON.stringify(manifest);
    const serverBlob = JSON.stringify(current.manifest);

    // Two independent questions, reported as two separate facts. Conflating
    // them was the old output's flaw. "Is my file the same as the server's
    // saved manifest?" and "is what's running the same as that manifest?" fail
    // for different reasons and have different fixes.
    section("Config");
    detail([
      ["project", project.slug],
      ["manifest", `v${current.version}`],
      ...(args.env ? ([["environment", args.env]] as Array<[string, string]>) : []),
    ]);
    out();

    if (localBlob === serverBlob) {
      ok("Local config matches the saved manifest.");
    } else if (current.manifest === null) {
      warn("Server has no saved manifest yet.");
      hint(`\`${cmd("deploy")}\` will publish this local config as v1`);
    } else {
      warn("Local config differs from the saved manifest.");
      hint(`run \`${cmd("deploy --dry-run")}\` to see what would change`);
    }

    // Independently, surface drift in the running RESOURCES vs the
    // current server manifest, meaning a delete or update done via
    // the UI since the last apply.
    const diff = await client.project.manifest.diff({
      projectId: project.id,
      environment: args.env,
    });
    const meaningful = diff.changes.filter((c) => c.kind !== "no-op");
    if (meaningful.length === 0) {
      ok("Running resources match the manifest.");
      return;
    }

    warn("Running resources have drifted from the manifest.");
    section("Drift");
    printDiff(meaningful);
    printChangeSummary(meaningful);
    out();
    note(dim("Drift usually means a change was made in the dashboard or another session."));
    hint(
      `run \`${cmd("deploy")}\` to reconcile, or \`${cmd("pull")}\` to adopt the server's state`,
    );

    const counts = countByKind(meaningful);
    // Non-zero exit so CI can gate on "did anyone change anything?".
    if (counts.delete || counts.create || counts.update) process.exitCode = 1;
    // Deletes are the one drift kind worth calling out by name before exit.
    if (counts.delete) {
      out();
      note(
        paint("danger", `${counts.delete} resource(s) exist in the manifest but not in reality.`),
      );
    }
  },
});
