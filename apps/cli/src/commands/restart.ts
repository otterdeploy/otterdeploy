import { defineCommand } from "citty";
import { consola } from "consola";

import { resolveResource } from "../lib/resolve";

export const restartCommand = defineCommand({
  meta: {
    name: "restart",
    description: "Restart a service (redeploy with current image and env)",
  },
  args: {
    service: { type: "positional", required: true, description: "Service name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const { client, projectId, resourceId, resourceName } = await resolveResource(
      args,
      args.service,
      "service",
    );
    const view = await client.service.restart({ projectId, resourceId });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(view, null, 2)}\n`);
      return;
    }
    consola.success(`Restarted ${resourceName} (runtime: ${view.runtime.status}).`);
  },
});
