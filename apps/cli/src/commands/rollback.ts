import { defineCommand } from "citty";

import { relativeTime, shortId, shortSha } from "../lib/format";
import { cmd } from "../lib/name";
import { resolveResource } from "../lib/resolve";
import { abort, confirm, detail, dim, note, ok, out, paint, section } from "../lib/ui";

interface DeploymentRow {
  id: string;
  image: string;
  status: string;
  gitSha: string | null;
  sourceSha: string | null;
  createdAt: string;
}

// The last settled prior deploy: newest superseded row that actually shipped
// an image (rows for queued git builds carry a "pending:" placeholder image).
function pickRollbackTarget(rows: DeploymentRow[]): DeploymentRow | undefined {
  return [...rows]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .find((r) => r.status === "superseded" && r.image !== "" && !r.image.startsWith("pending:"));
}

/** What the rollback will actually ship, as a reviewable block. */
function printTarget(target: DeploymentRow | undefined, deploymentId: string): void {
  section("Rollback target");
  if (!target) {
    // An explicitly-passed id we couldn't find locally. The server still
    // validates it, so say what we know rather than inventing detail.
    detail([["deployment", paint("id", shortId(deploymentId))]]);
    return;
  }
  const sha = shortSha(target.gitSha ?? target.sourceSha);
  detail([
    ["deployment", paint("id", shortId(target.id))],
    ["image", target.image],
    ["commit", sha === "" ? dim("–") : dim(sha)],
    ["deployed", dim(relativeTime(target.createdAt))],
  ]);
}

export const rollbackCommand = defineCommand({
  meta: {
    name: "rollback",
    description: "Roll a service back to a prior deployment's image",
  },
  args: {
    service: { type: "positional", required: true, description: "Service name" },
    deployment: {
      type: "positional",
      required: false,
      description: "Deployment id to roll back to (defaults to the last settled deploy)",
    },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    yes: { type: "boolean", description: "Skip confirmation prompt" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { client, projectId, resourceId, resourceName } = await resolveResource(
      args,
      args.service,
      "service",
    );

    const rows: DeploymentRow[] = await client.project.resource.deployments.list({
      projectId,
      resourceId,
    });

    let deploymentId: string;
    let target: DeploymentRow | undefined;
    if (args.deployment) {
      // Explicit id: details are cosmetic. The server validates existence.
      deploymentId = args.deployment;
      target = rows.find((r) => r.id === args.deployment);
    } else {
      const picked = pickRollbackTarget(rows);
      if (!picked) {
        abort(
          `No prior deployment to roll back to for ${resourceName}.`,
          `run \`${cmd(`deployments ${resourceName}`)}\` to see its history`,
        );
      }
      target = picked;
      deploymentId = picked.id;
    }

    if (!args.yes && !args.json) {
      printTarget(target, deploymentId);
      out();
      if (!(await confirm(`Roll back ${resourceName} to this deployment?`))) {
        abort("Aborted. Nothing was rolled back.");
      }
    }

    const view = await client.service.rollback({ projectId, resourceId, deploymentId });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
      return;
    }
    ok(`Rolled back ${resourceName} to ${shortId(deploymentId)}.`);
    detail([["image", view.image]]);
    note(dim("The service is rolling to the previous image."));
  },
});
