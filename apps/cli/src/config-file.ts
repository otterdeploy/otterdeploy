/**
 * Load + write the user's TypeScript config file.
 *
 * The file is `otterdeploy.config.ts` by default. It exports (default)
 * a `Manifest` object — usually wrapped in `defineConfig()` for type
 * inference. The CLI dynamically imports it at runtime (Bun handles TS
 * natively), validates the export against `manifestSchema`, and ships
 * the resulting JSON via the existing manifest.* contract.
 */

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { manifestSchema, type Manifest } from "@otterstack/api/manifest";

export const DEFAULT_CONFIG_FILENAME = "otterdeploy.config.ts";

export function configPath(override?: string, cwd = process.cwd()): string {
  return resolve(cwd, override ?? DEFAULT_CONFIG_FILENAME);
}

export function configExists(override?: string, cwd?: string): boolean {
  return existsSync(configPath(override, cwd));
}

export async function loadConfig(override?: string): Promise<Manifest> {
  const path = configPath(override);
  if (!existsSync(path)) {
    throw new Error(`No ${DEFAULT_CONFIG_FILENAME} at ${path}. Run \`otterdeploy init\`.`);
  }
  // file:// URL avoids ESM resolver complaining about absolute paths
  // on Windows + keeps cache busting deterministic.
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
  if (mod.default === undefined) {
    throw new Error(`${path} must \`export default\` a config (use defineConfig()).`);
  }
  // Validate the exported object against the wire schema — fails loudly
  // on typos, missing required fields, bad refs, etc.
  return manifestSchema.parse(mod.default) as Manifest;
}

export function writeConfigTemplate({
  path,
  schemaUrl,
  projectSlug,
}: {
  path: string;
  schemaUrl: string;
  projectSlug: string;
}): string {
  const body = `import { defineConfig } from "@otterstack/api/manifest";

export default defineConfig({
  $schema: ${JSON.stringify(schemaUrl)},
  project: ${JSON.stringify(projectSlug)},

  databases: {
    // primary: { engine: "postgres", version: "16" },
  },

  services: {
    // web: {
    //   source: "image",
    //   image: "ghcr.io/your-org/api:latest",
    //   replicas: 1,
    //   ports: [{ container: 3000, appProtocol: "http", primary: true }],
    //   env: {
    //     LOG_LEVEL: "info",
    //     DATABASE_URL: "\${database:primary.url}",
    //     STRIPE_KEY:   "\${secret}",
    //   },
    // },
  },

  // Optional per-environment overrides — deep-merged onto the base above.
  // environments: {
  //   production: {
  //     services: { web: { replicas: 3 } },
  //   },
  // },
});
`;
  writeFileSync(path, body);
  return path;
}
