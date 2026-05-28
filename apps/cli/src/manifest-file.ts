import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { manifestSchema, type Manifest } from "@otterstack/api/manifest";

export const MANIFEST_FILENAME = "otterstack.json";

export function manifestPath(cwd = process.cwd()): string {
  return resolve(cwd, MANIFEST_FILENAME);
}

export function loadManifestFile(cwd?: string): Manifest {
  const path = manifestPath(cwd);
  if (!existsSync(path)) {
    throw new Error(`No ${MANIFEST_FILENAME} in ${cwd ?? process.cwd()}. Run \`otterdeploy init\`.`);
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return manifestSchema.parse(raw);
}

export function writeManifestFile(manifest: Manifest, cwd?: string): string {
  const path = manifestPath(cwd);
  const body =
    JSON.stringify(
      {
        $schema: manifest.$schema,
        version: manifest.version ?? 1,
        project: manifest.project,
        databases: manifest.databases,
        services: manifest.services,
        environments: manifest.environments,
      },
      null,
      2,
    ) + "\n";
  writeFileSync(path, body);
  return path;
}

export function manifestExists(cwd?: string): boolean {
  return existsSync(manifestPath(cwd));
}
