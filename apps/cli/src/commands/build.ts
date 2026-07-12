import { defineCommand } from "citty";
import { consola } from "consola";

import { resolveResource } from "../lib/resolve";
import { waitForDeployments } from "../lib/wait";

export const buildCommand = defineCommand({
  meta: {
    name: "build",
    description: "Trigger a git build from the head of the service's bound branch",
  },
  args: {
    service: { type: "positional", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    wait: { type: "boolean", description: "Wait for the deployment to settle" },
    timeout: { type: "string", description: "Wait timeout in minutes (default from wait)" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    let timeoutMs: number | undefined;
    if (args.timeout !== undefined) {
      const minutes = Number(args.timeout);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        consola.error(`Invalid --timeout: ${args.timeout} (expected minutes, e.g. --timeout 20).`);
        process.exit(1);
      }
      timeoutMs = minutes * 60_000;
    }

    const { client, projectId, resourceId, resourceName } = await resolveResource(
      args,
      args.service,
      "service",
    );
    const { deploymentId } = await client.service.build({ projectId, resourceId });

    if (!args.wait) {
      if (args.json) {
        process.stdout.write(`${JSON.stringify({ deploymentId }, null, 2)}\n`);
        return;
      }
      consola.success(`Build queued for ${resourceName} — deployment ${deploymentId}.`);
      return;
    }

    if (!args.json) {
      consola.success(`Build queued for ${resourceName} — deployment ${deploymentId}.`);
    }
    const { ok, outcomes } = await waitForDeployments({
      client,
      projectId,
      targets: [{ resourceId, name: resourceName }],
      timeoutMs,
      json: args.json,
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ deploymentId, ok, outcomes }, null, 2)}\n`);
    }
    if (!ok) process.exitCode = 1;
  },
});
