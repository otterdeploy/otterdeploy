/**
 * `otd db rotate-password <database>`: rotate a managed
 * database's password on the engine and redeploy every service that uses it.
 * Split out of ./db so that file stays under its line cap.
 */
import { defineCommand } from "citty";

import { orAbsent } from "../lib/format";
import { resolveResource } from "../lib/resolve";
import { abort, confirm, detail, dim, note, ok, section, stateLabel, table, warn } from "../lib/ui";

/** Engines the control plane can rotate in place (see the API's
 *  password-rotation plans). Others get an honest refusal before any call. */
const ROTATABLE_ENGINES = new Set(["postgres", "mariadb", "mongodb"]);

export const rotatePasswordCmd = defineCommand({
  meta: {
    name: "rotate-password",
    description: "Rotate a database's password and redeploy every service that uses it",
  },
  args: {
    database: { type: "positional", required: true, description: "Database name" },
    yes: { type: "boolean", description: "Skip the confirmation prompt" },
    "keep-sessions": {
      type: "boolean",
      description: "Postgres: leave sessions opened with the old password running",
    },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const ctx = await resolveResource(args, args.database, "database");
    if (ctx.resourceEngine && !ROTATABLE_ENGINES.has(ctx.resourceEngine)) {
      abort(
        `Rotating a ${ctx.resourceEngine} password isn't supported yet.`,
        "postgres, mariadb and mongodb databases can be rotated",
      );
    }
    if (!args.yes) {
      note(
        dim(
          "The old password stops working immediately. Every service that uses this database is redeployed with the new one.",
        ),
      );
      const proceed = await confirm(`Rotate the password of ${ctx.resourceName}?`);
      if (!proceed) abort("Aborted. The password was not changed.");
    }
    const result = await ctx.client.project.resource.database.postgres.rotatePassword({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      terminateSessions: !args["keep-sessions"],
    });
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    ok(`Rotated the password of ${ctx.resourceName}.`);
    detail([
      ["variables rewritten", String(result.rewrittenVariables)],
      [
        "old sessions ended",
        result.terminatedSessions === null
          ? dim("not attempted")
          : String(result.terminatedSessions),
      ],
    ]);
    if (result.dependents.length === 0) {
      note("No services use this database, so nothing was redeployed.");
      return;
    }
    section("Redeployed");
    table(
      [{ header: "service" }, { header: "status" }, { header: "error" }],
      result.dependents.map((d) => [d.name, stateLabel(d.status), dim(orAbsent(d.error))]),
    );
    if (result.dependents.some((d) => d.status === "error")) {
      warn("Some services did not come up on the new password. Check their deployments.");
    }
  },
});
