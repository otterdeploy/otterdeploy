import type { OrganizationId } from "@otterdeploy/shared/id";
/**
 * Turn a Coolify import plan into otterdeploy projects (od-b34a.3).
 *
 * Deliberately built ON TOP of the manifest pipeline rather than raw resource
 * inserts: each planned project becomes a validated `Manifest` fed through
 * `applyManifest`, so imports reuse every creation rule the CLI/UI already
 * has — service provisioning, env writes (encrypted at rest, od-3pp7), the
 * `domains` create-time seed (custom domains enter the normal DNS-verify
 * flow), and the per-project apply queue. Nothing here talks to Docker.
 *
 * Import ≠ cutover: Coolify's containers keep running; imported databases
 * start empty; imported git services build on their first deploy.
 */
import type { RequestLogger } from "evlog";

import { db } from "@otterdeploy/db";
import { project as projectTable } from "@otterdeploy/db/schema";
import { Result } from "better-result";
import { and, eq } from "drizzle-orm";

import type { ApplyResult } from "../project/manifest-apply";
import type { CoolifyPlan, PlannedProject, PlannedService } from "./coolify";

import { resolveRemoteDefaultBranch } from "../../git";
import {
  manifestSchema,
  type DatabaseManifest,
  type Manifest,
  type ServiceManifest,
} from "../../stack/manifest/schema";
import { connectPublicRepo } from "../git/public-repos";
import { applyManifest } from "../project/manifest-apply";
import { resolveManifestRepo } from "../project/manifest-apply-git";
import { createProject } from "../project/projects";

export interface ImportedProjectResult {
  coolifyProject: string;
  /** The created otterdeploy project slug, or null when creation failed. */
  slug: string | null;
  services: number;
  databases: number;
  skipped: ApplyResult["skipped"];
  error: string | null;
}

export interface ImportResult {
  projects: ImportedProjectResult[];
}

/** Project slug from a Coolify project name: zSlug wants 2–48 chars. */
export function toProjectSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length >= 2 ? slug : `imported-${slug}`.slice(0, 48);
}

/** Same-name services in one Coolify project collide as map keys; suffix. */
function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let i = 2; taken.has(candidate); i++) candidate = `${name}-${i}`.slice(0, 63);
  taken.add(candidate);
  return candidate;
}

function toServiceManifest(svc: PlannedService): ServiceManifest {
  return {
    source: "git",
    ...(svc.repo ? { repo: svc.repo } : {}),
    ...(svc.branch ? { branch: svc.branch } : {}),
    ...(svc.sourceSubdir ? { sourceSubdir: svc.sourceSubdir } : {}),
    ...(svc.buildPack === "dockerfile"
      ? { build: { builder: "dockerfile", dockerfilePath: svc.dockerfilePath ?? null } }
      : {}),
    ...(svc.port !== null
      ? { ports: [{ container: svc.port, appProtocol: "http", primary: true }] }
      : {}),
    ...(svc.env.length > 0
      ? { env: Object.fromEntries(svc.env.map((e) => [e.key, e.value])) }
      : {}),
    ...(svc.domains.length > 0
      ? { domains: svc.domains.map((domain, i) => ({ domain, primary: i === 0 })) }
      : {}),
  };
}

/** Build + VALIDATE one project's manifest. Validation (not construction) is
 *  the contract: anything the plan produced that the manifest grammar rejects
 *  fails here, before any project is created. */
export function buildManifest(slug: string, project: PlannedProject): Result<Manifest, Error> {
  const taken = new Set<string>();
  const services: Record<string, ServiceManifest> = {};
  for (const svc of project.services) {
    services[uniqueName(svc.name, taken)] = toServiceManifest(svc);
  }
  const databases: Record<string, DatabaseManifest> = {};
  for (const database of project.databases) {
    databases[uniqueName(database.name, taken)] = { engine: database.engine };
  }
  return Result.try({
    try: () => manifestSchema.parse({ project: slug, services, databases }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
}

/** The ledger key a project imported from Coolify carries (project.importedFrom). */
function coolifyImportKey(project: Pick<PlannedProject, "sourceId">): string {
  return `coolify:${project.sourceId}`;
}

/** The project an earlier import of this source created in this org, if any. */
async function findImportedProject(organizationId: OrganizationId, importedFrom: string) {
  const [row] = await db
    .select({ slug: projectTable.slug })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.organizationId, organizationId),
        eq(projectTable.importedFrom, importedFrom),
      ),
    )
    .limit(1)
    .$withCache(false);
  return row ?? null;
}

/**
 * Bind each public-URL app's repository before the manifest applies
 *. The manifest names a repo as `owner/repo`, which resolves
 * only against the org's GitHub App installations or an existing public
 * binding; on a fresh install neither exists, so every imported git app came
 * in unbound and failed its first deploy. A repo an installation already owns
 * is left to it. An URL that cannot be bound leaves the service unbound, as
 * before (the plan already warns about it).
 */
async function bindPublicRepos(
  project: PlannedProject,
  organizationId: OrganizationId,
): Promise<void> {
  for (const svc of project.services) {
    if (!svc.repo || !svc.cloneUrl) continue;
    if ((await resolveManifestRepo(svc.repo, organizationId)) !== null) continue;
    await connectPublicRepo({
      cloneUrl: svc.cloneUrl,
      resolveDefaultBranch: resolveRemoteDefaultBranch,
    });
  }
}

/** Import every planned project into the caller's org. Per-project isolation:
 *  one bad project reports its error and the rest proceed. A project an
 *  earlier run already imported is reported as imported and left alone, so
 *  re-running the import is a no-op. */
export async function applyCoolifyPlan(input: {
  plan: CoolifyPlan;
  organizationId: OrganizationId;
  log: RequestLogger;
}): Promise<ImportResult> {
  const results: ImportedProjectResult[] = [];

  for (const project of input.plan.projects) {
    const base = toProjectSlug(project.name);
    const fail = (error: string) => {
      results.push({
        coolifyProject: project.name,
        slug: null,
        services: 0,
        databases: 0,
        skipped: [],
        error,
      });
    };

    const importedFrom = coolifyImportKey(project);
    const imported = (slug: string) =>
      results.push({
        coolifyProject: project.name,
        slug,
        services: project.services.length,
        databases: project.databases.length,
        skipped: [],
        error: null,
      });
    const earlier = await findImportedProject(input.organizationId, importedFrom);
    if (earlier) {
      imported(earlier.slug);
      continue;
    }

    // Slug collisions (an existing project of the same name) get a numbered
    // suffix rather than merging into an existing project: an import must
    // never mutate resources it didn't create.
    let created = null;
    let slug = base;
    for (let i = 2; i <= 5 && created === null; i++) {
      const attempt = await createProject({
        organizationId: input.organizationId,
        name: project.name,
        slug,
        importedFrom,
      });
      if (attempt.isOk()) {
        created = attempt.value;
        break;
      }
      slug = `${base}-${i}`.slice(0, 48);
    }
    if (created === null) {
      // A concurrent import of the same source may have won the ledger row.
      const racer = await findImportedProject(input.organizationId, importedFrom);
      if (racer) imported(racer.slug);
      else fail(`Could not create a project for "${project.name}" (slug conflicts).`);
      continue;
    }

    const manifest = buildManifest(slug, project);
    if (manifest.isErr()) {
      fail(`Manifest for "${project.name}" failed validation: ${manifest.error.message}`);
      continue;
    }

    await bindPublicRepos(project, input.organizationId);
    const applied = await Result.tryPromise({
      try: () =>
        applyManifest({
          projectId: created.id,
          organizationId: input.organizationId,
          manifest: manifest.value,
          log: input.log,
        }),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (applied.isErr()) {
      fail(`Apply failed for "${project.name}": ${applied.error.message}`);
      continue;
    }

    results.push({
      coolifyProject: project.name,
      slug,
      services: project.services.length,
      databases: project.databases.length,
      skipped: applied.value.skipped,
      error: null,
    });
  }

  return { projects: results };
}
