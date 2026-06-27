/**
 * Load + write the user's config file.
 *
 * Two on-disk formats are accepted:
 *   - otterdeploy.config.ts   — exports default a Manifest (usually via
 *                                defineConfig()). Loaded via dynamic import
 *                                (Bun handles TS natively).
 *   - otterdeploy.config.json — plain JSON. Loaded via Bun.file().json().
 *
 * Either way, the loaded value is validated against manifestSchema and
 * shipped on the wire as JSON via the existing manifest.* contract.
 */

import { manifestSchema, type Manifest } from "@otterdeploy/api/manifest";
import { Result, TaggedError } from "better-result";
// import { assert } from "node:test";
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// .json is the default format. .ts is supported for users who want
// type-checked authoring + env-var interpolation; .json is preferred
// when both are present (rare; usually only one exists).
const DEFAULT_CONFIG_BASENAMES = ["otterdeploy.config.json", "otterdeploy.config.ts"] as const;
const DEFAULT_CONFIG_FILENAME = DEFAULT_CONFIG_BASENAMES[0];

// Resolve to a concrete on-disk path:
//   - explicit --config wins
//   - else first default that exists wins
//   - else falls back to the .ts default (most relevant for fresh init)
export function configPath(override?: string, cwd = process.cwd()): string {
  if (override) return resolve(cwd, override);
  for (const name of DEFAULT_CONFIG_BASENAMES) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  return resolve(cwd, DEFAULT_CONFIG_FILENAME);
}

export function configExists(override?: string, cwd?: string): boolean {
  if (override) return existsSync(configPath(override, cwd));
  return DEFAULT_CONFIG_BASENAMES.some((name) => existsSync(resolve(cwd ?? process.cwd(), name)));
}

class LoadConfigError extends TaggedError("ConfigError")<{
  path: string;
  message: string;
}>() {
  constructor(args: { path: string; message?: string }) {
    super({ path: args.path, message: args.message ?? `Config error: ${args.path}` });
  }
}

export async function loadConfig(override?: string): Promise<Manifest> {
  const path = configPath(override);
  if (!existsSync(path)) {
    throw new LoadConfigError({
      path,
      message: `No config at ${path}. Run \`otterdeploy init\`.`,
    });
  }
  const ext = extname(path).toLowerCase();

  const rawResult = await Result.tryPromise({
    try: async (): Promise<unknown> => {
      if (ext === ".json") return Bun.file(path).json();
      // file:// URL avoids ESM resolver issues with absolute paths on
      // Windows + keeps cache-busting deterministic across reloads.
      const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
      assert(
        mod.default !== undefined,
        `${path} must \`export default\` a config (use defineConfig()).`,
      );
      return mod.default;
    },
    catch: (cause): Error => (cause instanceof Error ? cause : new Error(String(cause))),
  });

  if (rawResult.isErr()) {
    // Don't swallow: loadConfig's contract is "returns a Manifest or
    // throws". Anything else corrupts the downstream save/diff path.
    throw new LoadConfigError({ path, message: rawResult.error.message });
  }

  return manifestSchema.parse(rawResult.value) as Manifest;
}

// Write a populated manifest back to disk in the same format as the
// existing file. Used by `pull` (server → disk) and `add` (mutate-in-place).
// Note: TS round-trip drops comments and reformats — acceptable for
// CLI-mutating verbs since the user opted in by running them.
export function writeConfig(manifest: Manifest, override?: string): string {
  const path = configPath(override);
  const ext = extname(path).toLowerCase();
  const ordered = {
    $schema: manifest.$schema,
    version: manifest.version ?? 1,
    project: manifest.project,
    databases: manifest.databases,
    services: manifest.services,
    ...(manifest.environments ? { environments: manifest.environments } : {}),
  };
  const body =
    ext === ".json"
      ? `${JSON.stringify(ordered, null, 2)}\n`
      : `import { defineConfig } from "@otterdeploy/api/manifest";\n\nexport default defineConfig(${JSON.stringify(ordered, null, 2)});\n`;
  writeFileSync(path, body);
  return path;
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
  const ext = extname(path).toLowerCase();
  if (ext === ".json") {
    const body = `${JSON.stringify(
      {
        $schema: schemaUrl,
        version: 1,
        project: projectSlug,
        databases: {},
        services: {},
      },
      null,
      2,
    )}\n`;
    writeFileSync(path, body);
    return path;
  }

  const body = `import { defineConfig } from "@otterdeploy/api/manifest";

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
