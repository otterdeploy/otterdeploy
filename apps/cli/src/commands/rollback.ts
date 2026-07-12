import { defineCommand } from "citty";
import { consola } from "consola";

import { resolveResource } from "../lib/resolve";

interface DeploymentRow {
  id: string;
  image: string;
  status: string;
  gitSha: string | null;
  createdAt: string;
}

function shortId(id: string): string {
  const sep = id.indexOf("_");
  return sep === -1 ? id.slice(0, 8) : `${id.slice(0, sep + 1)}${id.slice(sep + 1, sep + 9)}`;
}

function formatAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// The last settled prior deploy: newest superseded row that actually shipped
// an image (rows for queued git builds carry a "pending:" placeholder image).
function pickRollbackTarget(rows: DeploymentRow[]): DeploymentRow | undefined {
  return [...rows]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .find((r) => r.status === "superseded" && r.image !== "" && !r.image.startsWith("pending:"));
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
      // Explicit id: details are cosmetic — the server validates existence.
      deploymentId = args.deployment;
      target = rows.find((r) => r.id === args.deployment);
    } else {
      const picked = pickRollbackTarget(rows);
      if (!picked) {
        consola.error(`No prior deployment to roll back to for ${resourceName}.`);
        process.exit(1);
      }
      target = picked;
      deploymentId = picked.id;
    }

    if (!args.yes && !args.json) {
      if (target) {
        consola.info(
          `Target: ${shortId(target.id)}  image ${target.image}` +
            `${target.gitSha ? `  git ${target.gitSha.slice(0, 7)}` : ""}` +
            `  (${formatAge(target.createdAt)})`,
        );
      } else {
        consola.info(`Target: ${deploymentId}`);
      }
      const ok = await consola.prompt(`Roll back ${resourceName} to this deployment?`, {
        type: "confirm",
        initial: false,
      });
      if (!ok) {
        consola.info("Aborted.");
        process.exit(1);
      }
    }

    const view = await client.service.rollback({ projectId, resourceId, deploymentId });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
      return;
    }
    consola.success(
      `Rolled back ${resourceName} to ${shortId(deploymentId)} (image ${view.image}).`,
    );
  },
});
