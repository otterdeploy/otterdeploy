/**
 * Coolify detection + transport (od-b34a.1/.2).
 *
 * Scope (v1): the single-host migration — Coolify running on the SAME docker
 * daemon this control plane manages, which is the common "installed
 * otterdeploy next to Coolify to move off it" path. Detection lists the
 * daemon's containers; reads exec `psql` inside Coolify's own postgres
 * container (its creds live in that container's env, never typed by anyone),
 * and rows come back as `row_to_json` lines so the reader tolerates schema
 * drift across Coolify versions instead of pinning column lists. The
 * row→plan mapping is pure and lives in ./coolify-plan.ts.
 *
 * Env values are decrypted with the APP_KEY read from the Coolify app
 * container's env (Laravel `encrypted` cast; see ./laravel-crypt.ts) and are
 * re-encrypted at rest by otterdeploy's own env pipeline the moment the
 * import writes them (od-3pp7) — plaintext never lands in our DB.
 */
import { Docker } from "@otterdeploy/docker";
import { Result } from "better-result";
import * as z from "zod";

import type { CoolifyPlan, PlannedDatabase } from "./coolify-plan";

import { collectStream, demuxDockerStream } from "../firewall/cscli";
import { buildCoolifyPlan } from "./coolify-plan";
import { decryptLaravelValue, looksLaravelEncrypted, parseAppKey } from "./laravel-crypt";

export type { CoolifyPlan, PlannedProject, PlannedService } from "./coolify-plan";
export { normalizeDomains, normalizeRepo, toResourceName } from "./coolify-plan";

const EXEC_TIMEOUT_MS = 30_000;

// ── Detection ───────────────────────────────────────────────────────────

export interface DetectedPlatform {
  platform: "coolify" | "dokploy" | "caprover";
  version: string | null;
  containers: string[];
  /** Whether this build ships an importer for it. */
  importSupported: boolean;
}

interface RunningContainer {
  id: string;
  name: string;
  image: string;
}

async function listRunning(docker: Docker): Promise<RunningContainer[]> {
  const list = await docker.containers.list({});
  if (list.isErr()) return [];
  return list.value
    .filter((c) => c.State === "running")
    .map((c) => ({
      id: c.Id,
      name: (c.Names?.[0] ?? "").replace(/^\//, ""),
      image: c.Image ?? "",
    }));
}

function imageVersion(image: string): string | null {
  const tag = image.split(":").at(-1);
  return tag && tag !== "latest" && !tag.includes("/") ? tag : null;
}

/** Signature containers per platform. Names are the platforms' own compose
 *  defaults; matching is prefix-based so `coolify-db-1` style suffixes hit. */
function matchPlatforms(containers: RunningContainer[]): DetectedPlatform[] {
  const found: DetectedPlatform[] = [];
  const byPrefix = (p: string) => containers.filter((c) => c.name.startsWith(p));

  const coolify = byPrefix("coolify");
  if (coolify.some((c) => c.image.includes("coollabsio/coolify"))) {
    const app = coolify.find((c) => c.image.includes("coollabsio/coolify:"));
    found.push({
      platform: "coolify",
      version: app ? imageVersion(app.image) : null,
      containers: coolify.map((c) => c.name).sort(),
      importSupported: true,
    });
  }

  const dokploy = containers.filter((c) => c.image.includes("dokploy/dokploy"));
  if (dokploy.length > 0) {
    found.push({
      platform: "dokploy",
      version: imageVersion(dokploy[0]?.image ?? ""),
      containers: dokploy.map((c) => c.name).sort(),
      importSupported: false,
    });
  }

  const caprover = byPrefix("captain-captain");
  if (caprover.length > 0) {
    found.push({
      platform: "caprover",
      version: imageVersion(caprover[0]?.image ?? ""),
      containers: caprover.map((c) => c.name).sort(),
      importSupported: false,
    });
  }
  return found;
}

export async function detectPlatforms(): Promise<DetectedPlatform[]> {
  const docker = Docker.fromEnv();
  try {
    return matchPlatforms(await listRunning(docker));
  } finally {
    docker.destroy();
  }
}

// ── Exec + read plumbing ────────────────────────────────────────────────

/** Exec a fixed, TRUSTED command in a container; merged output or null. */
async function execIn(docker: Docker, containerId: string, cmd: string[]): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), EXEC_TIMEOUT_MS);
  });
  const run = (async () => {
    const exec = await docker.containers.getContainer(containerId).exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    if (exec.isErr()) return null;
    const stream = await exec.value.start({});
    if (stream.isErr()) return null;
    return demuxDockerStream(await collectStream(stream.value));
  })();
  try {
    return await Promise.race([timedOut, run]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** psql inside coolify-db, one row_to_json per line. The SQL is a fixed
 *  string authored here (never user input). A missing table (older Coolify)
 *  prints an ERROR line, which the `{`-filter drops → zero rows. */
async function readRows(
  docker: Docker,
  dbContainerId: string,
  sql: string,
): Promise<Result<unknown[], Error>> {
  const out = await execIn(docker, dbContainerId, [
    "sh",
    "-lc",
    `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -t -A -c 'SELECT row_to_json(t) FROM (${sql}) t'`,
  ]);
  if (out === null) return Result.err(new Error("coolify-db exec failed or timed out"));
  return Result.try({
    try: () =>
      out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("{"))
        .map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line))),
    catch: () => new Error(`unexpected psql output: ${out.slice(0, 300)}`),
  });
}

interface CoolifyContainers {
  app: RunningContainer;
  db: RunningContainer;
}

async function findCoolify(docker: Docker): Promise<Result<CoolifyContainers, Error>> {
  const containers = await listRunning(docker);
  const app = containers.find((c) => c.image.includes("coollabsio/coolify:"));
  const db = containers.find((c) => c.name.startsWith("coolify-db"));
  if (!app || !db) {
    return Result.err(
      new Error(
        "No running Coolify install found on this docker daemon (need coolify + coolify-db).",
      ),
    );
  }
  return Result.ok({ app, db });
}

/** APP_KEY from the Coolify app container's env (inspect, no exec needed). */
async function readAppKey(docker: Docker, appContainerId: string): Promise<Result<Buffer, Error>> {
  const inspected = await docker.containers.getContainer(appContainerId).inspect();
  if (inspected.isErr()) return Result.err(new Error("could not inspect the coolify container"));
  const envs: string[] = inspected.value.Config?.Env ?? [];
  const raw = envs.find((e) => e.startsWith("APP_KEY="))?.slice("APP_KEY=".length);
  if (!raw) {
    return Result.err(new Error("Coolify container has no APP_KEY; cannot decrypt env values"));
  }
  const key = parseAppKey(raw);
  return key.isErr() ? Result.err(new Error(key.error.message)) : Result.ok(key.value);
}

const DB_TABLES: Array<{ table: string; engine: PlannedDatabase["engine"] }> = [
  { table: "standalone_postgresqls", engine: "postgres" },
  { table: "standalone_redis", engine: "redis" },
  { table: "standalone_mariadbs", engine: "mariadb" },
  { table: "standalone_mongodbs", engine: "mongodb" },
];

/** Read Coolify's DB and shape the import plan. Read-only end to end. */
export async function planCoolifyImport(): Promise<Result<CoolifyPlan, Error>> {
  const docker = Docker.fromEnv();
  try {
    const containers = await findCoolify(docker);
    if (containers.isErr()) return Result.err(containers.error);
    const { app, db } = containers.value;

    const appKey = await readAppKey(docker, app.id);
    if (appKey.isErr()) return Result.err(appKey.error);

    const [projects, environments, applications, envVars] = await Promise.all([
      readRows(docker, db.id, "SELECT id, name FROM projects"),
      readRows(docker, db.id, "SELECT id, name, project_id FROM environments"),
      readRows(docker, db.id, "SELECT * FROM applications"),
      readRows(docker, db.id, "SELECT * FROM environment_variables"),
    ]);
    if (projects.isErr()) return Result.err(projects.error);
    if (environments.isErr()) return Result.err(environments.error);
    if (applications.isErr()) return Result.err(applications.error);
    if (envVars.isErr()) return Result.err(envVars.error);

    const databases: Array<{ engine: PlannedDatabase["engine"]; rows: unknown[] }> = [];
    for (const { table, engine } of DB_TABLES) {
      const rows = await readRows(docker, db.id, `SELECT id, name, environment_id FROM ${table}`);
      databases.push({ engine, rows: rows.isOk() ? rows.value : [] });
    }

    const key = appKey.value;
    const decrypt = (value: string): string | null => {
      if (!looksLaravelEncrypted(value)) return value;
      const decrypted = decryptLaravelValue(value, key);
      return decrypted.isOk() ? decrypted.value : null;
    };

    return Result.ok(
      buildCoolifyPlan(
        {
          projects: projects.value,
          environments: environments.value,
          applications: applications.value,
          envVars: envVars.value,
          databases,
        },
        decrypt,
        imageVersion(app.image),
      ),
    );
  } finally {
    docker.destroy();
  }
}
