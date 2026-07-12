import { defineCommand } from "citty";
import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";

function cell(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width);
}

export const auditCommand = defineCommand({
  meta: { name: "audit", description: "List organization audit log events" },
  args: {
    limit: { type: "string", description: "Max events to return (1-200, default 50)" },
    failed: { type: "boolean", description: "Only events with outcome=failure" },
    action: { type: "string", description: "Filter by exact action, e.g. project.delete" },
    actor: { type: "string", description: "Filter by actor id" },
    search: { type: "string", description: "Substring search across action/actor/target" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
    if (
      args.limit &&
      (!Number.isInteger(limit) || limit === undefined || limit < 1 || limit > 200)
    ) {
      consola.error("--limit must be an integer between 1 and 200.");
      process.exit(1);
    }

    const { url, token } = await ensureAuthenticated(args.url);
    const client = createCliClient({ url, token });

    const input: {
      limit?: number;
      outcome?: "success" | "failure" | "denied";
      action?: string;
      actorId?: string;
      q?: string;
    } = {};
    if (limit !== undefined) input.limit = limit;
    if (args.failed) input.outcome = "failure";
    if (args.action) input.action = args.action;
    if (args.actor) input.actorId = args.actor;
    if (args.search) input.q = args.search;

    const result = await client.audit.list(input);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    const { items, counts } = result;
    if (items.length === 0) {
      consola.info("No audit events match.");
      return;
    }
    for (const event of items) {
      const actor = event.actorEmail ?? event.actorLabel ?? event.actorId;
      const target =
        event.targetType && event.targetId
          ? `${event.targetType}/${event.targetId}`
          : (event.targetType ?? event.targetId ?? "");
      consola.log(
        `${event.timestamp}  ${cell(actor, 28)}  ${cell(event.action, 26)}  ${event.outcome.padEnd(7)}  ${target}`,
      );
    }
    consola.info(
      `${items.length} of ${counts.total} event(s) — ${counts.failed} failed, ${counts.denied} denied.`,
    );
  },
});
