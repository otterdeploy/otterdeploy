import { defineCommand } from "citty";

import { shortId } from "../lib/format";
import { cmd } from "../lib/name";
import { resolveResource } from "../lib/resolve";
import { abort, detail, hint, ok, paint, section } from "../lib/ui";
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
    "no-cache": {
      type: "boolean",
      description: "Rebuild from scratch, ignoring every build cache",
    },
    timeout: { type: "string", description: "Wait timeout in minutes (default from wait)" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    let timeoutMs: number | undefined;
    if (args.timeout !== undefined) {
      const minutes = Number(args.timeout);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        abort(
          `--timeout expects a positive number of minutes, got "${args.timeout}".`,
          "for example `--timeout 20`",
        );
      }
      timeoutMs = minutes * 60_000;
    }

    const { client, projectId, resourceId, resourceName } = await resolveResource(
      args,
      args.service,
      "service",
    );
    const { deploymentId } = await client.service.build({
      projectId,
      resourceId,
      ...(args["no-cache"] ? { noCache: true } : {}),
    });

    if (!args.json) {
      ok(`Build queued for ${resourceName}${args["no-cache"] ? " (no cache)" : ""}.`);
      section("Deployment");
      detail([["id", paint("id", shortId(deploymentId))]]);
      if (!args.wait) {
        hint(`run \`${cmd(`logs ${resourceName} --build`)}\` to follow it`);
        hint(`or re-run with \`--wait\` to block until it settles`);
      }
    }

    if (!args.wait) {
      if (args.json) process.stdout.write(`${JSON.stringify({ deploymentId }, null, 2)}\n`);
      return;
    }

    // `succeeded`, not `ok`: `ok` is the outcome printer imported above.
    const { ok: succeeded, outcomes } = await waitForDeployments({
      client,
      projectId,
      targets: [{ resourceId, name: resourceName }],
      timeoutMs,
      json: args.json,
    });
    if (args.json) {
      process.stdout.write(
        `${JSON.stringify({ deploymentId, ok: succeeded, outcomes }, null, 2)}\n`,
      );
    }
    if (!succeeded) process.exitCode = 1;
  },
});
