/**
 * Environment-override merge for the JSON manifest.
 *
 *   Objects        → deep-merged (recurse)
 *   Scalars        → override replaces base
 *   Arrays         → override replaces base wholesale (no per-element merge)
 *   `null` value   → deletes the key from the base
 *   Missing key    → inherits base unchanged
 *   Discriminator  → if `source` (services) or `engine` (databases) differs,
 *                    the override fully replaces the base block — no
 *                    cross-discriminator deep merge.
 *
 * Returns a new manifest object with environment overrides resolved.
 */

import type { Manifest } from "./schema";

const SERVICE_DISCRIMINATOR = "source";
const DATABASE_DISCRIMINATOR = "engine";

export function resolveEnvironment(manifest: Manifest, environment?: string): Manifest {
  if (!environment) return manifest;
  const overrides = manifest.environments?.[environment];
  if (!overrides) return manifest;

  return {
    ...manifest,
    services: mergeResources(
      manifest.services,
      overrides.services,
      SERVICE_DISCRIMINATOR,
    ) as Manifest["services"],
    databases: mergeResources(
      manifest.databases,
      overrides.databases,
      DATABASE_DISCRIMINATOR,
    ) as Manifest["databases"],
  };
}

function mergeResources(
  base: Record<string, unknown> | undefined,
  override: Record<string, unknown> | undefined,
  discriminator: string,
): Record<string, unknown> {
  if (!override) return { ...base };

  const result: Record<string, unknown> = { ...base };
  for (const [name, overrideBlock] of Object.entries(override)) {
    if (overrideBlock === null) {
      delete result[name];
      continue;
    }
    const baseBlock = result[name];
    if (!isObject(baseBlock) || !isObject(overrideBlock)) {
      result[name] = overrideBlock;
      continue;
    }
    // Discriminator change → replace wholesale to avoid hybrids
    // (image+git, postgres+redis).
    const baseDisc = baseBlock[discriminator];
    const overrideDisc = overrideBlock[discriminator];
    if (overrideDisc !== undefined && overrideDisc !== baseDisc) {
      result[name] = overrideBlock;
      continue;
    }
    result[name] = deepMerge(baseBlock, overrideBlock);
  }
  return result;
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === null) {
      delete result[key];
      continue;
    }
    if (isObject(value) && isObject(result[key]) && !Array.isArray(value) && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key], value);
      continue;
    }
    // Scalars + arrays + new keys all hit this branch — override replaces base.
    result[key] = value;
  }
  return result;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
