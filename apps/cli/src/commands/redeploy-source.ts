/**
 * What `redeploy` does with a service the server will not rebuild from git.
 *
 * `service.build` only rebuilds git-sourced services, and the CLI read its
 * refusal as "this service runs a prebuilt image". An
 * upload-built service (`otterdeploy add service --upload`, `otterdeploy up`)
 * is not one: it is built on the server from source this CLI uploads. So the
 * service's own source decides, as the project's saved manifest records it:
 *   - upload, and this directory is its project: upload this directory's
 *     source again and rebuild it (the same upload `deploy` does);
 *   - upload, anywhere else: say where the source lives, never "image";
 *   - anything else: a prebuilt image, nothing to rebuild.
 */
import { dirname } from "node:path";

import { ensureAuthenticated } from "../auth-flow";
import { configExists, configPath, loadConfig } from "../config-file";
import { uploadServiceSource } from "../lib/deploy-run";
import { cmd } from "../lib/name";
import { type ResourceContext } from "../lib/resolve";
import { abort, note } from "../lib/ui";

export type NonGitRedeploy = "image" | "upload-here" | "upload-elsewhere";

/** Which way a non-git redeploy goes; see the module comment. */
export function nonGitRedeploy(input: {
  /** The service's `source` in the server's saved manifest. */
  serverSource: string | undefined;
  /** This directory's config, when there is one. */
  local: { project: string; source: string | undefined } | null;
  projectSlug: string;
}): NonGitRedeploy {
  if (input.serverSource !== "upload") return "image";
  const here = input.local?.project === input.projectSlug && input.local.source === "upload";
  return here ? "upload-here" : "upload-elsewhere";
}

/** What this needs of a resolved resource: its names, and a client that can
 *  read the project's saved manifest. */
export type NonGitTarget = Pick<
  ResourceContext,
  "url" | "projectId" | "projectSlug" | "resourceId" | "resourceName"
> & {
  client: {
    project: {
      manifest: {
        get(input: { id: string }): Promise<{
          manifest: { services?: Record<string, { source?: string } | undefined> } | null;
        }>;
      };
    };
  };
};

/** The service's source as the project's saved manifest records it. */
async function serverSourceOf(ctx: NonGitTarget): Promise<string | undefined> {
  const { manifest } = await ctx.client.project.manifest.get({ id: ctx.projectId });
  return manifest?.services?.[ctx.resourceName]?.source;
}

/** This directory's config, read only when one is there. */
async function localSourceOf(
  config: string | undefined,
  name: string,
): Promise<{ project: string; source: string | undefined } | null> {
  if (!configExists(config)) return null;
  const local = await loadConfig(config);
  return { project: local.project, source: local.services?.[name]?.source };
}

/**
 * Redeploy a service `service.build` refused as not git-sourced: rebuild an
 * upload-built one from this directory, or say what does work. Returns the
 * queued deployment id; aborts when there is nothing it can rebuild.
 */
export async function redeployNonGit(
  ctx: NonGitTarget,
  opts: { config?: string; json: boolean },
): Promise<string> {
  const way = nonGitRedeploy({
    serverSource: await serverSourceOf(ctx),
    local: await localSourceOf(opts.config, ctx.resourceName),
    projectSlug: ctx.projectSlug,
  });
  if (way === "image") {
    // Both recoveries are real and different, so both are offered.
    abort(
      `${ctx.resourceName} runs a prebuilt image, so there is nothing to rebuild.`,
      `run \`${cmd(`restart ${ctx.resourceName}`)}\` to roll it with the current image`,
      `or change its image tag and run \`${cmd("deploy")}\``,
    );
  }
  if (way === "upload-elsewhere") {
    abort(
      `${ctx.resourceName} is built from uploaded source, and this directory is not its project (${ctx.projectSlug}).`,
      `run \`${cmd("deploy")}\` in its project directory to upload and rebuild it`,
      `or run \`${cmd(`restart ${ctx.resourceName}`)}\` to roll the current build`,
    );
  }
  if (!opts.json)
    note(`${ctx.resourceName} is built from uploaded source: rebuilding this directory.`);
  const session = await ensureAuthenticated(ctx.url);
  const { deploymentId } = await uploadServiceSource({
    url: session.url,
    token: session.token,
    projectDir: dirname(configPath(opts.config)),
    resourceId: ctx.resourceId,
    name: ctx.resourceName,
    json: opts.json,
  });
  return deploymentId;
}
