/**
 * Environment-override merge for the JSON manifest.
 *
 *   Objects        → deep-merged (recurse)
 *   Scalars        → override replaces base
 *   Arrays         → override replaces base wholesale (no per-element merge)
 *   `null` value   → deletes the key from the base
 *   Missing key    → inherits base unchanged
 *   Discriminator  → if `source` (services) or `engine` (databases) differs,
 *                    the override fully replaces the base block, no
 *                    cross-discriminator deep merge.
 *
 * Returns a new manifest object with environment overrides resolved.
 */

import { isJsonObject, type JsonObject } from "@otterdeploy/shared/json";

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
  base: JsonObject | undefined,
  override: JsonObject | undefined,
  discriminator: string,
): JsonObject {
  if (!override) return { ...base };

  const result: JsonObject = { ...base };
  for (const [name, overrideBlock] of Object.entries(override)) {
    if (overrideBlock === null) {
      delete result[name];
      continue;
    }
    const baseBlock = result[name];
    if (!isJsonObject(baseBlock) || !isJsonObject(overrideBlock)) {
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

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result: JsonObject = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === null) {
      delete result[key];
      continue;
    }
    const existing = result[key];
    if (isJsonObject(value) && isJsonObject(existing)) {
      result[key] = deepMerge(existing, value);
      continue;
    }
    // Scalars + arrays + new keys all hit this branch: override replaces base.
    result[key] = value;
  }
  return result;
}
