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

import type * as z from "zod";

import { isJsonObject, type JsonObject } from "@otterdeploy/shared/json";
import { Result, TaggedError } from "better-result";

import { manifestSchema, type Manifest } from "./schema";

/**
 * An environment block that merges into something the schema rejects: an
 * override adding a service with no `source`, say. A mistake in the document,
 * not a server fault, so it travels as a typed error the handlers map to a 400,
 * carrying the issues so the message can name the resource and the field.
 */
export class ManifestMergeError extends TaggedError("ManifestMergeError")<{
  message: string;
  environment: string;
  /** Which map failed to validate after merging. */
  map: "services" | "databases";
  issues: string[];
}>() {
  constructor(args: {
    environment: string;
    map: "services" | "databases";
    issues: readonly z.core.$ZodIssue[];
  }) {
    const issues = args.issues.map(
      (issue) => `${[args.map, ...issue.path.map(String)].join(".")}: ${issue.message}`,
    );
    super({
      environment: args.environment,
      map: args.map,
      issues,
      message: `environment "${args.environment}" does not merge into a valid manifest. ${issues.join("; ")}`,
    });
  }
}

const SERVICE_DISCRIMINATOR = "source";
const DATABASE_DISCRIMINATOR = "engine";

// Guards, not transforms: `safeParse(...).success` narrows the merged map to
// the manifest's own type while returning the ORIGINAL object untouched (no
// key stripping, no defaults applied). This is where the schema's promise
// that "the merged result is what the server validates strictly" is kept.
const servicesMapSchema = manifestSchema.shape.services;
const databasesMapSchema = manifestSchema.shape.databases;

function isServicesMap(value: JsonObject): value is JsonObject & Manifest["services"] {
  return servicesMapSchema.safeParse(value).success;
}

function isDatabasesMap(value: JsonObject): value is JsonObject & Manifest["databases"] {
  return databasesMapSchema.safeParse(value).success;
}

/** The issues behind a failed guard above. Only runs on the failure path. */
function issuesOf(schema: z.ZodType, value: JsonObject): readonly z.core.$ZodIssue[] {
  const parsed = schema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues;
}

export function resolveEnvironment(
  manifest: Manifest,
  environment?: string,
): Result<Manifest, ManifestMergeError> {
  if (!environment) return Result.ok(manifest);
  const overrides = manifest.environments?.[environment];
  if (!overrides) return Result.ok(manifest);

  const services = mergeResources(manifest.services, overrides.services, SERVICE_DISCRIMINATOR);
  const databases = mergeResources(manifest.databases, overrides.databases, DATABASE_DISCRIMINATOR);
  if (!isServicesMap(services)) {
    return Result.err(
      new ManifestMergeError({
        environment,
        map: "services",
        issues: issuesOf(servicesMapSchema, services),
      }),
    );
  }
  if (!isDatabasesMap(databases)) {
    return Result.err(
      new ManifestMergeError({
        environment,
        map: "databases",
        issues: issuesOf(databasesMapSchema, databases),
      }),
    );
  }

  return Result.ok({
    ...manifest,
    services,
    databases,
  });
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
