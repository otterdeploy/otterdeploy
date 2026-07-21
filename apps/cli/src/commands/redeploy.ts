import { ORPCError } from "@orpc/client";
import { defineCommand } from "citty";
import { consola } from "consola";

import type { ResourceContext } from "../lib/resolve";

import { resolveResource } from "../lib/resolve";
import { waitForDeployments } from "../lib/wait";

// Parse an optional --timeout (minutes) shared by the service/compose paths.
function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    consola.error(`Invalid --timeout: ${raw} (expected minutes, e.g. --timeout 20).`);
    process.exit(1);
  }
  return minutes * 60_000;
}

// A git-sourced service: rebuild from the head of its bound branch (same path
// as `otterdeploy build`). Image-sourced services have nothing to build —
// point the user at `restart` / an image change instead of a raw error code.
async function redeployService(
  ctx: ResourceContext,
  opts: { wait: boolean; timeoutMs?: number; json: boolean },
): Promise<void> {
  let deploymentId: string;
  try {
    ({ deploymentId } = await ctx.client.service.build({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
    }));
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_GIT_SOURCED") {
      consola.error(`${ctx.resourceName} runs a prebuilt image — there is nothing to rebuild.`);
      consola.info(
        `Use \`otterdeploy restart ${ctx.resourceName}\` to roll it, or change its image tag and \`otterdeploy deploy\`.`,
      );
      process.exit(1);
    }
    throw error;
  }

  if (!opts.wait) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ deploymentId }, null, 2)}\n`);
      return;
    }
    consola.success(`Redeploy queued for ${ctx.resourceName} — deployment ${deploymentId}.`);
    return;
  }

  if (!opts.json) {
    consola.success(`Redeploy queued for ${ctx.resourceName} — deployment ${deploymentId}.`);
  }
  const { ok, outcomes } = await waitForDeployments({
    client: ctx.client,
    projectId: ctx.projectId,
    targets: [{ resourceId: ctx.resourceId, name: ctx.resourceName }],
    timeoutMs: opts.timeoutMs,
    json: opts.json,
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ deploymentId, ok, outcomes }, null, 2)}\n`);
  }
  if (!ok) process.exitCode = 1;
}

// A compose stack: `compose.redeploy` re-clones at branch HEAD (git stacks),
// rebuilds any `build:` services, and re-applies the stack. It returns a
// coarse {ok,error,status} rather than a deployment id — the stack resource's
// own deployment rows are what `--wait` follows.
async function redeployCompose(
  ctx: ResourceContext,
  opts: { wait: boolean; timeoutMs?: number; json: boolean },
): Promise<void> {
  const result = await ctx.client.compose.redeploy({
    projectId: ctx.projectId,
    resourceId: ctx.resourceId,
  });

  if (!result.ok) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      consola.error(`Redeploy failed for ${ctx.resourceName}: ${result.error ?? result.status}`);
    }
    process.exitCode = 1;
    return;
  }

  if (!opts.wait) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    consola.success(`Redeploy queued for ${ctx.resourceName} (${result.status}).`);
    return;
  }

  if (!opts.json) {
    consola.success(`Redeploy queued for ${ctx.resourceName} (${result.status}).`);
  }
  const { ok, outcomes } = await waitForDeployments({
    client: ctx.client,
    projectId: ctx.projectId,
    targets: [{ resourceId: ctx.resourceId, name: ctx.resourceName }],
    timeoutMs: opts.timeoutMs,
    json: opts.json,
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ...result, ok, outcomes }, null, 2)}\n`);
  }
  if (!ok) process.exitCode = 1;
}

export const redeployCommand = defineCommand({
  meta: {
    name: "redeploy",
    description: "Rebuild a service or compose stack from the head of its bound branch",
  },
  args: {
    resource: {
      type: "positional",
      required: true,
      description: "Service or compose stack name",
    },
    config: { type: "string", description: "Path to config file" },
    slug: { type: "string", description: "Project slug (defaults to config)" },
    url: { type: "string", description: "Override control plane URL" },
    wait: { type: "boolean", description: "Wait for the deployment to settle" },
    timeout: { type: "string", description: "Wait timeout in minutes (default from wait)" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const timeoutMs = parseTimeout(args.timeout);
    // No kind filter — resolve first, then dispatch on the resource type so a
    // stack and a service share one verb (the audit's missing `redeploy`).
    const ctx = await resolveResource(args, args.resource);
    const opts = { wait: Boolean(args.wait), timeoutMs, json: Boolean(args.json) };

    if (ctx.resourceType === "service") {
      await redeployService(ctx, opts);
      return;
    }
    if (ctx.resourceType === "compose") {
      await redeployCompose(ctx, opts);
      return;
    }
    consola.error(
      `${ctx.resourceName} is a ${ctx.resourceType}; only services and compose stacks can be redeployed.`,
    );
    process.exit(1);
  },
});
