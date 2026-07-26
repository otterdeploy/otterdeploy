import { defineCommand } from "citty";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { orAbsent, relativeTime, truncate } from "../lib/format";
import { abort, detail, dim, note, out, paint, section, stateLabel, table } from "../lib/ui";

const MAX_LIMIT = 200;
/** Actor emails and action names get long; clip so they can't set the width. */
const MAX_ACTOR = 28;
const MAX_ACTION = 30;

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
      (!Number.isInteger(limit) || limit === undefined || limit < 1 || limit > MAX_LIMIT)
    ) {
      abort("--limit must be a whole number between 1 and 200.", "for example `--limit 100`");
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
      note("No audit events match.");
      return;
    }
    section("Audit events");
    table(
      [
        { header: "when" },
        { header: "actor" },
        { header: "action" },
        { header: "outcome" },
        { header: "target" },
      ],
      items.map((event) => {
        const actor = event.actorEmail ?? event.actorLabel ?? event.actorId;
        const target =
          event.targetType && event.targetId
            ? `${event.targetType}/${event.targetId}`
            : (event.targetType ?? event.targetId ?? "");
        return [
          dim(relativeTime(String(event.timestamp))),
          truncate(actor, MAX_ACTOR),
          truncate(event.action, MAX_ACTION),
          // success/failure/denied are in the shared state vocabulary, so a
          // denied event reads as impaired rather than as an outright failure.
          stateLabel(event.outcome),
          dim(orAbsent(target)),
        ];
      }),
    );

    out();
    detail([
      ["shown", `${items.length} of ${counts.total}`],
      ["failed", counts.failed > 0 ? paint("danger", String(counts.failed)) : dim("0")],
      ["denied", counts.denied > 0 ? paint("warn", String(counts.denied)) : dim("0")],
    ]);
  },
});
