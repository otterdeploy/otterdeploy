import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  getProjectCaddyConfigRecord,
  listProjectCaddyConfigRecords,
  markProjectCaddyConfigInvalid,
  markProjectCaddyConfigValid,
  upsertProjectCaddyConfigDraft,
  type ProjectCaddyConfigRecord,
} from "@otterstack/db";
import { env } from "@otterstack/env/server";

import {
  buildLayer4Wrapper,
  buildProjectDirectory,
  buildRevision,
  buildRootCaddyfile,
  extractClaimsFromHttpJson,
  extractClaimsFromLayer4Json,
  mergeClaims,
  parseCsvSet,
  type ProjectCaddySnapshot,
  sanitizeProjectSlug,
  validateClaimConflicts,
  validateProjectScope,
  type ProjectClaims,
  type ValidationIssue,
} from "./config";

export type ProjectCaddyConfigView = {
  id: string | null;
  projectId: string;
  environmentId: string | null;
  httpCaddyfile: string;
  layer4Caddyfile: string;
  status: "draft" | "valid" | "invalid";
  lastAppliedRevision: string | null;
  lastAppliedAt: string | null;
  lastError: string | null;
  projectSlug: string;
  paths: {
    rootCaddyfile: string;
    projectDirectory: string;
    httpCaddyfile: string;
    layer4Caddyfile: string;
  };
};

export type SaveProjectCaddyConfigResult = {
  config: ProjectCaddyConfigView;
  validationErrors: string[];
};

export async function getProjectCaddyConfig(projectId: string): Promise<ProjectCaddyConfigView> {
  const existing = await getProjectCaddyConfigRecord(projectId);

  return toProjectConfigView(existing, projectId);
}

export async function saveProjectCaddyConfig(input: {
  projectId: string;
  httpCaddyfile: string;
  layer4Caddyfile: string;
}): Promise<SaveProjectCaddyConfigResult> {
  await upsertProjectCaddyConfigDraft(input);

  const snapshots = await loadSnapshots(input.projectId);
  const candidate = snapshots.find((snapshot) => snapshot.projectId === input.projectId);

  if (!candidate) {
    throw new Error(`Failed to load saved Caddy config for project "${input.projectId}".`);
  }

  const validationErrors = await validateAndApplySnapshots(snapshots, candidate);

  if (validationErrors.length > 0) {
    await markProjectCaddyConfigInvalid(input.projectId, validationErrors);

    const invalidConfig = await getProjectCaddyConfig(input.projectId);
    return {
      config: invalidConfig,
      validationErrors,
    };
  }

  const activeRoot = buildRootCaddyfile(env.CADDY_CONFIG_DIR, snapshots, env.CADDY_ADMIN_BIND);
  const revision = buildRevision(activeRoot);
  const appliedAt = new Date();

  await markProjectCaddyConfigValid({
    projectId: input.projectId,
    httpCaddyfile: input.httpCaddyfile,
    layer4Caddyfile: input.layer4Caddyfile,
    revision,
    appliedAt,
  });

  const validConfig = await getProjectCaddyConfig(input.projectId);
  return {
    config: validConfig,
    validationErrors: [],
  };
}

async function loadSnapshots(candidateProjectId?: string): Promise<ProjectCaddySnapshot[]> {
  const configs = await listProjectCaddyConfigRecords();

  return configs.map((config) => ({
    projectId: config.projectId,
    environmentId: config.environmentId,
    httpCaddyfile:
      config.projectId === candidateProjectId
        ? config.httpCaddyfile
        : config.appliedHttpCaddyfile || config.httpCaddyfile,
    layer4Caddyfile:
      config.projectId === candidateProjectId
        ? config.layer4Caddyfile
        : config.appliedLayer4Caddyfile || config.layer4Caddyfile,
  }));
}

async function validateAndApplySnapshots(
  snapshots: ProjectCaddySnapshot[],
  candidate: ProjectCaddySnapshot,
): Promise<string[]> {
  const scopeIssues = snapshots.flatMap((snapshot) => validateProjectScope(snapshot));
  if (scopeIssues.length > 0) {
    return formatIssues(scopeIssues);
  }

  const stageRoot = await mkdtemp(path.join(tmpdir(), "otterstack-caddy-"));

  try {
    await writeSnapshotFiles(stageRoot, snapshots);

    const allClaims = new Map<string, ProjectClaims>();
    for (const snapshot of snapshots) {
      const claims = await extractClaimsForSnapshot(stageRoot, snapshot);
      allClaims.set(snapshot.projectId, claims);
    }

    const candidateClaims = allClaims.get(candidate.projectId) ?? {
      httpHosts: [],
      layer4Listeners: [],
      layer4Snis: [],
    };

    const claimIssues = validateClaimConflicts(
      candidate,
      candidateClaims,
      allClaims,
      parseCsvSet(env.CADDY_RESERVED_HOSTS),
      parseCsvSet(env.CADDY_RESERVED_LAYER4_PORTS),
    );

    if (claimIssues.length > 0) {
      return formatIssues(claimIssues);
    }

    const stagedRootText = await readFile(path.join(stageRoot, "Caddyfile"), "utf8");
    await adaptCaddyfile(stagedRootText);
    await loadCaddyfile(stagedRootText);
    await syncActiveConfig(snapshots);

    return [];
  } catch (error) {
    return [toErrorMessage(error)];
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

async function writeSnapshotFiles(rootDir: string, snapshots: ProjectCaddySnapshot[]) {
  await mkdir(path.join(rootDir, "projects"), { recursive: true });

  for (const snapshot of snapshots) {
    const projectDir = buildProjectDirectory(rootDir, snapshot.projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "http.caddy"), snapshot.httpCaddyfile, "utf8");
    await writeFile(path.join(projectDir, "layer4.caddy"), snapshot.layer4Caddyfile, "utf8");
  }

  await writeFile(
    path.join(rootDir, "Caddyfile"),
    buildRootCaddyfile(rootDir, snapshots, env.CADDY_ADMIN_BIND),
    "utf8",
  );
}

async function extractClaimsForSnapshot(
  rootDir: string,
  snapshot: ProjectCaddySnapshot,
): Promise<ProjectClaims> {
  const httpClaims = snapshot.httpCaddyfile.trim()
    ? extractClaimsFromHttpJson(await adaptCaddyfile(snapshot.httpCaddyfile))
    : {
        httpHosts: [],
        layer4Listeners: [],
        layer4Snis: [],
      };

  const layer4Claims = snapshot.layer4Caddyfile.trim()
    ? extractClaimsFromLayer4Json(await adaptCaddyfile(buildLayer4Wrapper(rootDir, snapshot)))
    : {
        httpHosts: [],
        layer4Listeners: [],
        layer4Snis: [],
      };

  return mergeClaims(httpClaims, layer4Claims);
}

async function syncActiveConfig(snapshots: ProjectCaddySnapshot[]) {
  await rm(path.join(env.CADDY_CONFIG_DIR, "projects"), { recursive: true, force: true });
  await mkdir(path.join(env.CADDY_CONFIG_DIR, "projects"), { recursive: true });

  for (const snapshot of snapshots) {
    const projectDir = buildProjectDirectory(env.CADDY_CONFIG_DIR, snapshot.projectId);
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "http.caddy"), snapshot.httpCaddyfile, "utf8");
    await writeFile(path.join(projectDir, "layer4.caddy"), snapshot.layer4Caddyfile, "utf8");
  }

  await writeFile(
    path.join(env.CADDY_CONFIG_DIR, "Caddyfile"),
    buildRootCaddyfile(env.CADDY_CONFIG_DIR, snapshots, env.CADDY_ADMIN_BIND),
    "utf8",
  );
}

async function adaptCaddyfile(caddyfile: string): Promise<unknown> {
  const response = await fetch(new URL("/adapt", env.CADDY_ADMIN_URL), {
    method: "POST",
    headers: {
      "Content-Type": "text/caddyfile",
    },
    body: caddyfile,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

async function loadCaddyfile(caddyfile: string): Promise<void> {
  const response = await fetch(new URL("/load", env.CADDY_ADMIN_URL), {
    method: "POST",
    headers: {
      "Content-Type": "text/caddyfile",
      "Cache-Control": "must-revalidate",
    },
    body: caddyfile,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function toProjectConfigView(
  config: ProjectCaddyConfigRecord | undefined,
  projectId: string,
): ProjectCaddyConfigView {
  const projectSlug = sanitizeProjectSlug(projectId);
  const projectDirectory = buildProjectDirectory(env.CADDY_CONFIG_DIR, projectId);

  return {
    id: config?.id ?? null,
    projectId,
    environmentId: config?.environmentId ?? null,
    httpCaddyfile: config?.httpCaddyfile ?? "",
    layer4Caddyfile: config?.layer4Caddyfile ?? "",
    status: config?.status ?? "draft",
    lastAppliedRevision: config?.lastAppliedRevision ?? null,
    lastAppliedAt: config?.lastAppliedAt?.toISOString() ?? null,
    lastError: config?.lastError ?? null,
    projectSlug,
    paths: {
      rootCaddyfile: path.join(env.CADDY_CONFIG_DIR, "Caddyfile"),
      projectDirectory,
      httpCaddyfile: path.join(projectDirectory, "http.caddy"),
      layer4Caddyfile: path.join(projectDirectory, "layer4.caddy"),
    },
  };
}

function formatIssues(issues: ValidationIssue[]): string[] {
  return issues.map((issue) => issue.message);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown Caddy reconciliation error.";
}
