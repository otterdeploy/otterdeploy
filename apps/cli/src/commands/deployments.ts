import { defineCommand } from "citty";

import { elapsed, orAbsent, relativeTime, shortId, shortSha, truncate } from "../lib/format";
import { cmd } from "../lib/name";
import { resolveResource } from "../lib/resolve";
import { dim, hint, note, out, paint, section, stateLabel, table } from "../lib/ui";

const DEFAULT_LIMIT = 20;
/** Long enough to identify a failure, short enough not to set the table width. */
const MAX_ERROR_LENGTH = 60;

export const deploymentsCommand = defineCommand({
  meta: {
    name: "deployments",
    description: "List deployment history for a service or compose stack",
  },
  args: {
    service: {
      type: "positional",
      required: false,
      description: "Service or compose stack name",
    },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    limit: { type: "string", description: "Max deployments to show (default 20)" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    // No kind filter: deployment history is resource-type-agnostic on the
    // server (project.resource.deployments.list keys off resourceId), so a
    // compose stack lists its own deploy rows here too.
    const ctx = await resolveResource(args, args.service);
    const rows = await ctx.client.project.resource.deployments.list({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
    });
    const parsed = args.limit ? Number.parseInt(args.limit, 10) : DEFAULT_LIMIT;
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
    const shown = rows.slice(0, limit);

    if (args.json) {
      process.stdout.write(`${JSON.stringify(shown, null, 2)}\n`);
      return;
    }
    if (shown.length === 0) {
      note(`No deployments yet for ${ctx.resourceName}.`);
      hint(`run \`${cmd(`build ${ctx.resourceName}`)}\` to create one`);
      return;
    }

    section(`Deployments ${dim(ctx.resourceName)}`);
    // Columns are content-measured (see ui/render.ts), which replaces the old
    // hand-tuned pads that sheared whenever an enum value grew.
    table(
      [
        { header: "id" },
        { header: "status" },
        { header: "reason" },
        { header: "sha" },
        { header: "created" },
        { header: "took", align: "right" },
        { header: "error" },
      ],
      shown.map((d) => [
        paint("id", shortId(d.id)),
        stateLabel(d.status),
        dim(d.reason),
        dim(orAbsent(shortSha(d.gitSha ?? d.sourceSha))),
        dim(relativeTime(d.createdAt)),
        dim(elapsed(d.createdAt, d.completedAt)),
        d.errorMessage ? paint("danger", truncate(d.errorMessage, MAX_ERROR_LENGTH)) : "",
      ]),
    );

    // Say so when the list was cut, rather than letting it look complete.
    if (rows.length > shown.length) {
      out();
      note(
        dim(`Showing ${shown.length} of ${rows.length}. Use \`--limit ${rows.length}\` for all.`),
      );
    }

    const newest = shown[0];
    if (newest && (newest.status === "failed" || newest.status === "crashed")) {
      hint(`run \`${cmd(`logs ${ctx.resourceName} --build`)}\` to see why the newest one failed`);
    }
  },
});
