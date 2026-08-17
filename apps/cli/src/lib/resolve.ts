/**
 * Shared project/resource resolution for commands that target a service or
 * database by name. Slug precedence: --slug flag > local config's `project`.
 *
 * The not-found paths matter more than the happy path here: "which service did
 * you mean" is the single most common way a command fails, so a miss answers with
 * the closest name and the real inventory rather than a comma-spliced blob.
 */

import { ensureAuthenticated } from "../auth-flow";
import { createCliClient } from "../client";
import { configExists, loadConfig } from "../config-file";
import { cmd } from "./name";
import { suggestions } from "./suggest";
import { abort, dim, err, kindBadge, row, stateGlyph } from "./ui";

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
    abort(
      "No project to act on.",
      "pass `--slug <slug>`",
      `or run \`${cmd("init")}\` in this directory to create a config`,
    );
  }
  const project = await client.project.getBySlug({ slug });
  return { client, url, projectId: project.id, projectSlug: slug };
}

export interface ResourceContext extends ProjectContext {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  /** Engine for databases (`postgres`, `redis`, …); undefined for every other
   *  kind. Carried here because "which database engine" decides which endpoint
   *  a verb can call. `restart` has one for postgres and none for the rest. */
  resourceEngine?: string;
}

interface ResourceRow {
  name: string;
  type: string;
  status?: string;
}

/**
 * Print the project's inventory to stderr so a failed lookup shows what *is*
 * there. Listing them as real rows (glyph, name, kind) means the reader can
 * copy a name straight out of the error.
 */
function printInventory(resources: ResourceRow[]): void {
  if (resources.length === 0) return;
  err();
  for (const r of resources) {
    row([stateGlyph(r.status ?? "valid"), r.name, kindBadge(r.type)]);
  }
  err();
}

export async function resolveResource(
  args: { slug?: string; config?: string; url?: string },
  name: string | undefined,
  // Optional filter, e.g. "service" when the verb only makes sense there.
  kind?: string,
): Promise<ResourceContext> {
  const ctx = await resolveProject(args);
  const noun = kind ?? "resource";
  if (!name) {
    abort(`Pass a ${noun} name.`, `run \`${cmd("status")}\` to list this project's resources`);
  }

  const resources = await ctx.client.project.resource.list({ projectId: ctx.projectId });
  const candidates = kind ? resources.filter((r) => r.type === kind) : resources;
  const match = resources.find((r) => r.name === name);

  if (!match) {
    const near = suggestions(
      name,
      candidates.map((r) => r.name),
    );
    printInventory(candidates);
    abort(
      `No ${noun} named \`${name}\` in project ${ctx.projectSlug}.`,
      ...near.map((candidate) => `did you mean \`${candidate}\`?`),
      ...(candidates.length === 0 ? [`this project has no ${noun}s yet`] : []),
    );
  }
  if (kind && match.type !== kind) {
    abort(
      `\`${name}\` is a ${match.type}, not a ${kind}.`,
      `${dim("this command only operates on")} ${kind}s`,
    );
  }
  return {
    ...ctx,
    resourceId: match.resourceId,
    resourceName: match.name,
    resourceType: match.type,
    resourceEngine: match.type === "database" ? match.engine : undefined,
  };
}
