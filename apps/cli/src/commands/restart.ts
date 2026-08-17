import { defineCommand } from "citty";

import type { ResourceContext } from "../lib/resolve";

import { cmd } from "../lib/name";
import { resolveResource } from "../lib/resolve";
import { abort, detail, ok, stateLabel } from "../lib/ui";

/** Database engines the control plane can roll today. Postgres is the only one
 *  with a restart endpoint; the others have no route to call, so they get an
 *  honest refusal rather than a generic "not a service". */
const RESTARTABLE_ENGINES = new Set(["postgres"]);

async function restartDatabase(ctx: ResourceContext): Promise<{ status: string }> {
  if (!ctx.resourceEngine || !RESTARTABLE_ENGINES.has(ctx.resourceEngine)) {
    abort(
      `Restarting a ${ctx.resourceEngine ?? "database"} database isn't supported yet.`,
      "only postgres databases can be restarted from the CLI today",
      "restart it from the dashboard in the meantime",
    );
  }
  const view = await ctx.client.project.resource.database.postgres.restart({
    projectId: ctx.projectId,
    resourceId: ctx.resourceId,
  });
  return { status: view.runtime.status };
}

export const restartCommand = defineCommand({
  meta: {
    name: "restart",
    description: "Restart a service or database (roll it with the current image and env)",
  },
  args: {
    resource: { type: "positional", required: true, description: "Service or database name" },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    // No kind filter: resolve first, then dispatch on the resource type, the
    // same shape `redeploy` uses. A database has a perfectly good restart
    // endpoint, and filtering to "service" here made it unreachable from the
    // CLI entirely even though the dashboard could do it.
    const ctx = await resolveResource(args, args.resource);

    if (ctx.resourceType === "compose") {
      abort(
        `${ctx.resourceName} is a compose stack.`,
        `run \`${cmd(`redeploy ${ctx.resourceName}`)}\` to re-apply the stack`,
      );
    }

    const result =
      ctx.resourceType === "database"
        ? await restartDatabase(ctx)
        : await ctx.client.service
            .restart({ projectId: ctx.projectId, resourceId: ctx.resourceId })
            .then((view) => ({ status: view.runtime.status }));

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    ok(`Restarted ${ctx.resourceName}.`);
    detail([["runtime", stateLabel(result.status)]]);
  },
});
