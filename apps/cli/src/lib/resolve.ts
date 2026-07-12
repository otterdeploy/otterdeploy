/**
 * Shared project/resource resolution for commands that target a service or
 * database by name. Slug precedence: --slug flag > local config's `project`.
 * Errors are thrown (not printed) so the index.ts error boundary owns the
 * exit path.
 */

import { consola } from "consola";

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { configExists, loadConfig } from "../config-file";

export type CliClient = ReturnType<typeof createCliClient>;

export interface ProjectContext {
  client: CliClient;
  url: string;
  projectId: string;
  projectSlug: string;
}

export async function resolveProject(args: {
  slug?: string;
  config?: string;
  url?: string;
}): Promise<ProjectContext> {
  const { url, token } = await ensureAuthenticated(args.url);
  const client = createCliClient({ url, token });
  const slug =
    args.slug ?? (configExists(args.config) ? (await loadConfig(args.config)).project : null);
  if (!slug) {
    consola.error("No --slug provided and no local config to read it from.");
    process.exit(1);
  }
  const project = await client.project.getBySlug({ slug });
  return { client, url, projectId: project.id, projectSlug: slug };
}

export interface ResourceContext extends ProjectContext {
  resourceId: string;
  resourceName: string;
  resourceType: string;
}

export async function resolveResource(
  args: { slug?: string; config?: string; url?: string },
  name: string | undefined,
  // Optional filter, e.g. "service" when the verb only makes sense there.
  kind?: string,
): Promise<ResourceContext> {
  const ctx = await resolveProject(args);
  if (!name) {
    consola.error(`Pass a ${kind ?? "resource"} name.`);
    process.exit(1);
  }
  const resources = await ctx.client.project.resource.list({ projectId: ctx.projectId });
  const match = resources.find((r) => r.name === name);
  if (!match) {
    const available = resources.map((r) => r.name).join(", ") || "(none)";
    consola.error(
      `${kind ?? "Resource"} ${name} not found in project ${ctx.projectSlug}. Available: ${available}`,
    );
    process.exit(1);
  }
  if (kind && match.type !== kind) {
    consola.error(`${name} is a ${match.type}, not a ${kind}.`);
    process.exit(1);
  }
  return {
    ...ctx,
    resourceId: match.resourceId,
    resourceName: match.name,
    resourceType: match.type,
  };
}
