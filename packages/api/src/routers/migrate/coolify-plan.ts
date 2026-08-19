/**
 * Pure Coolify → plan mapping (od-b34a.2). No Docker, no IO: this module
 * takes ALREADY-FETCHED row sets (parsed loosely, so Coolify schema drift
 * degrades to skipped rows instead of a failed import) plus a decryptor for
 * the Laravel `encrypted` cast, and shapes the import plan. Splitting the
 * mapping from the transport keeps it unit-testable against fixtures and
 * keeps ./coolify.ts down to detection + exec plumbing.
 */
import * as z from "zod";

const projectRow = z.looseObject({ id: z.number(), name: z.string() });
const environmentRow = z.looseObject({
  id: z.number(),
  name: z.string(),
  project_id: z.number(),
});
const applicationRow = z.looseObject({
  id: z.number(),
  name: z.string(),
  environment_id: z.number(),
  fqdn: z.string().nullish(),
  git_repository: z.string().nullish(),
  git_branch: z.string().nullish(),
  build_pack: z.string().nullish(),
  base_directory: z.string().nullish(),
  dockerfile_location: z.string().nullish(),
  ports_exposes: z.string().nullish(),
});
const envVarRow = z.looseObject({
  key: z.string(),
  value: z.string().nullish(),
  resourceable_type: z.string().nullish(),
  resourceable_id: z.number().nullish(),
  is_preview: z.boolean().nullish(),
});
const standaloneDbRow = z.looseObject({
  id: z.number(),
  name: z.string(),
  environment_id: z.number(),
});

function parseAll<T>(rows: unknown[], schema: z.ZodType<T>): T[] {
  const out: T[] = [];
  for (const row of rows) {
    const parsed = schema.safeParse(row);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

// ── Plan shapes ─────────────────────────────────────────────────────────

interface PlannedEnvVar {
  key: string;
  value: string;
}

export interface PlannedService {
  name: string;
  repo: string | null;
  branch: string | null;
  buildPack: string | null;
  dockerfilePath: string | null;
  sourceSubdir: string | null;
  port: number | null;
  domains: string[];
  env: PlannedEnvVar[];
  warnings: string[];
}

export interface PlannedDatabase {
  name: string;
  engine: "postgres" | "redis" | "mariadb" | "mongodb";
}

export interface PlannedProject {
  name: string;
  services: PlannedService[];
  databases: PlannedDatabase[];
}

export interface CoolifyPlan {
  version: string | null;
  projects: PlannedProject[];
  /** Global caveats the operator must read before applying. */
  warnings: string[];
}

// ── Field mappers ───────────────────────────────────────────────────────

/** "https://github.com/o/r(.git)" | "git@github.com:o/r.git" | "o/r" → "o/r". */
export function normalizeRepo(gitRepository: string | null | undefined): string | null {
  if (!gitRepository) return null;
  const cleaned = gitRepository
    .replace(/^git@[^:]+:/, "")
    .replace(/^[a-z+]+:\/\/[^/]+\//i, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/");
  return parts.length === 2 && parts.every(Boolean) ? cleaned : null;
}

/** Coolify fqdn: comma-separated URLs ("https://a.com,https://b.com"). */
export function normalizeDomains(fqdn: string | null | undefined): string[] {
  if (!fqdn) return [];
  return fqdn
    .split(",")
    .map(
      (entry) =>
        entry
          .trim()
          .replace(/^[a-z+]+:\/\//i, "")
          .split("/")[0] ?? "",
    )
    .filter((d) => d.length > 0);
}

/** otterdeploy resource-name slug from a Coolify display name. */
export function toResourceName(name: string, fallback: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 63);
  return slug.length > 0 ? slug : fallback;
}

const ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

// ── Assembly ────────────────────────────────────────────────────────────

export interface CoolifyRows {
  projects: unknown[];
  environments: unknown[];
  applications: unknown[];
  envVars: unknown[];
  /** Standalone-database rows, already labeled with their engine. */
  databases: Array<{ engine: PlannedDatabase["engine"]; rows: unknown[] }>;
}

/** Decrypt one stored env value; null = skip it (undecryptable). */
export type EnvDecryptor = (value: string) => string | null;

function collectEnvsByApp(
  rows: unknown[],
  decrypt: EnvDecryptor,
  warnings: string[],
): Map<number, PlannedEnvVar[]> {
  const byApp = new Map<number, PlannedEnvVar[]>();
  for (const v of parseAll(rows, envVarRow)) {
    if (v.is_preview === true) continue;
    if (!v.resourceable_type?.endsWith("Application") || v.resourceable_id == null) continue;
    if (v.value == null) continue;
    const value = decrypt(v.value);
    if (value === null) {
      warnings.push(`Could not decrypt env "${v.key}" (app #${v.resourceable_id}): skipped.`);
      continue;
    }
    const list = byApp.get(v.resourceable_id) ?? [];
    list.push({ key: v.key, value });
    byApp.set(v.resourceable_id, list);
  }
  return byApp;
}

function toPlannedService(a: z.infer<typeof applicationRow>, env: PlannedEnvVar[]): PlannedService {
  const warnings: string[] = [];
  const repo = normalizeRepo(a.git_repository);
  if (!repo) {
    warnings.push(
      `Repository "${a.git_repository ?? "(none)"}" is not owner/repo-shaped; the service imports unbound — connect its repo in otterdeploy before deploying.`,
    );
  }
  const validEnv: PlannedEnvVar[] = [];
  for (const item of env) {
    if (ENV_KEY_RE.test(item.key)) validEnv.push(item);
    else warnings.push(`Env key "${item.key}" is not UPPER_SNAKE; add it manually after import.`);
  }
  const port = Number.parseInt(a.ports_exposes?.split(",")[0] ?? "", 10);
  return {
    name: toResourceName(a.name, `app-${a.id}`),
    repo,
    branch: a.git_branch ?? null,
    buildPack: a.build_pack ?? null,
    dockerfilePath: a.dockerfile_location ?? null,
    sourceSubdir: a.base_directory && a.base_directory !== "/" ? a.base_directory : null,
    port: Number.isFinite(port) ? port : null,
    domains: normalizeDomains(a.fqdn),
    env: validEnv,
    warnings,
  };
}

const GLOBAL_WARNINGS = [
  "Database CONTENTS are not copied: imported databases start empty. Dump/restore data manually after import.",
  "Coolify one-click services (compose templates) are not imported in v1; only git applications and standalone databases.",
  "Coolify itself is left untouched: its containers keep running until you shut it down.",
];

/** Shape the plan from raw row sets. Pure; fixture-testable. */
export function buildCoolifyPlan(
  rows: CoolifyRows,
  decrypt: EnvDecryptor,
  version: string | null,
): CoolifyPlan {
  const warnings: string[] = [];
  const envToProject = new Map<number, number>();
  for (const e of parseAll(rows.environments, environmentRow)) {
    envToProject.set(e.id, e.project_id);
  }

  const envsByApp = collectEnvsByApp(rows.envVars, decrypt, warnings);

  const dbsByProject = new Map<number, PlannedDatabase[]>();
  for (const { engine, rows: engineRows } of rows.databases) {
    for (const row of parseAll(engineRows, standaloneDbRow)) {
      const projectId = envToProject.get(row.environment_id);
      if (projectId === undefined) continue;
      const list = dbsByProject.get(projectId) ?? [];
      list.push({ name: toResourceName(row.name, `${engine}-${row.id}`), engine });
      dbsByProject.set(projectId, list);
    }
  }

  const servicesByProject = new Map<number, PlannedService[]>();
  for (const a of parseAll(rows.applications, applicationRow)) {
    const projectId = envToProject.get(a.environment_id);
    if (projectId === undefined) continue;
    const list = servicesByProject.get(projectId) ?? [];
    list.push(toPlannedService(a, envsByApp.get(a.id) ?? []));
    servicesByProject.set(projectId, list);
  }

  const projects: PlannedProject[] = [];
  for (const p of parseAll(rows.projects, projectRow)) {
    const services = servicesByProject.get(p.id) ?? [];
    const databases = dbsByProject.get(p.id) ?? [];
    if (services.length === 0 && databases.length === 0) continue;
    projects.push({ name: p.name, services, databases });
  }

  return { version, projects, warnings: [...warnings, ...GLOBAL_WARNINGS] };
}
