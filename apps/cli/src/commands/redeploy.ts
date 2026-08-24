import { ORPCError } from "@orpc/client";
import { defineCommand } from "citty";

import type { ResourceContext } from "../lib/resolve";

import { shortId } from "../lib/format";
import { cmd } from "../lib/name";
import { resolveResource } from "../lib/resolve";
import { abort, detail, hint, ok, paint, section } from "../lib/ui";
import { waitForDeployments } from "../lib/wait";

// Parse an optional --timeout (minutes) shared by the service/compose paths.
function parseTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    abort(
      `--timeout expects a positive number of minutes, got "${raw}".`,
      "for example `--timeout 20`",
    );
  }
  return minutes * 60_000;
}

/** Shared tail: announce the queued deployment, then optionally wait on it. */
async function announceAndWait(
  ctx: ResourceContext,
  opts: { wait: boolean; timeoutMs?: number; json: boolean },
  announce: { deploymentId?: string; status?: string; payload: object },
): Promise<void> {
  if (!opts.json) {
    ok(`Redeploy queued for ${ctx.resourceName}.`);
    if (announce.deploymentId || announce.status) {
      section("Deployment");
      detail([
        ["id", announce.deploymentId ? paint("id", shortId(announce.deploymentId)) : ""],
        ["status", announce.status ?? ""],
      ]);
    }
    if (!opts.wait) hint(`re-run with \`--wait\` to block until it settles`);
  }

  if (!opts.wait) {
    if (opts.json) process.stdout.write(`${JSON.stringify(announce.payload, null, 2)}\n`);
    return;
  }

  // `succeeded`, not `ok`: `ok` is the outcome printer imported above.
  const { ok: succeeded, outcomes } = await waitForDeployments({
    client: ctx.client,
    projectId: ctx.projectId,
    targets: [{ resourceId: ctx.resourceId, name: ctx.resourceName }],
    timeoutMs: opts.timeoutMs,
    json: opts.json,
  });
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ ...announce.payload, ok: succeeded, outcomes }, null, 2)}\n`,
    );
  }
  if (!succeeded) process.exitCode = 1;
}

// A git-sourced service: rebuild from the head of its bound branch (same path
// as `build`). Image-sourced services have nothing to build. Point the user at
// `restart` / an image change instead of a raw error code.
async function redeployService(
  ctx: ResourceContext,
  opts: { wait: boolean; timeoutMs?: number; json: boolean; noCache?: boolean },
): Promise<void> {
  let deploymentId: string;
  try {
    ({ deploymentId } = await ctx.client.service.build({
      projectId: ctx.projectId,
      resourceId: ctx.resourceId,
      ...(opts.noCache ? { noCache: true } : {}),
    }));
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_GIT_SOURCED") {
      // Both recoveries are real and different, so both are offered.
      abort(
        `${ctx.resourceName} runs a prebuilt image, so there is nothing to rebuild.`,
        `run \`${cmd(`restart ${ctx.resourceName}`)}\` to roll it with the current image`,
        `or change its image tag and run \`${cmd("deploy")}\``,
      );
    }
    throw error;
  }

  await announceAndWait(ctx, opts, { deploymentId, payload: { deploymentId } });
}

// A compose stack: `compose.redeploy` re-clones at branch HEAD (git stacks),
// rebuilds any `build:` services, and re-applies the stack. It returns a
// coarse {ok,error,status} rather than a deployment id: the stack resource's
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
      process.exitCode = 1;
      return;
    }
    abort(
      `Redeploy failed for ${ctx.resourceName}: ${result.error ?? result.status}`,
      `run \`${cmd(`logs ${ctx.resourceName} --build`)}\` for the build output`,
    );
  }

  await announceAndWait(ctx, opts, { status: result.status, payload: result });
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
    "no-cache": {
      type: "boolean",
      description: "Rebuild from scratch, ignoring every build cache (git services only)",
    },
    timeout: { type: "string", description: "Wait timeout in minutes (default from wait)" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run({ args }) {
    const timeoutMs = parseTimeout(args.timeout);
    // No kind filter: resolve first, then dispatch on the resource type so a
    // stack and a service share one verb (the audit's missing `redeploy`).
    const ctx = await resolveResource(args, args.resource);
    const opts = {
      wait: Boolean(args.wait),
      timeoutMs,
      json: Boolean(args.json),
      noCache: Boolean(args["no-cache"]),
    };

    if (ctx.resourceType === "service") {
      await redeployService(ctx, opts);
      return;
    }
    if (ctx.resourceType === "compose") {
      await redeployCompose(ctx, opts);
      return;
    }
    // Previously this printed and then fell through with exit code 0, so a
    // no-op redeploy of a database looked like a success.
    //
    // A database runs a prebuilt engine image, so there is genuinely nothing to
    // rebuild, but say what DOES work, the way the image-sourced service path
    // above does. An error that only names the refusal is a dead end.
    abort(
      `${ctx.resourceName} is a ${ctx.resourceType}. Redeploy rebuilds from source, and an engine image has none.`,
      `run \`${cmd(`restart ${ctx.resourceName}`)}\` to roll it with the current image and env`,
      "or change its engine version to move it to a new image",
    );
  },
});
