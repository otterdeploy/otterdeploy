/**
 * Parse + normalize a user-supplied Docker Compose file into `ParsedCompose`.
 *
 * Compose is permissive — every field has 2-3 accepted spellings. We accept the
 * common real-world shapes and collapse them into one normal form (see
 * `./types`). Unsupported constructs become non-fatal `warnings`; only a
 * structurally broken file (bad YAML, no services, a service with neither image
 * nor build) is a hard error. Parsing is server-side via `Bun.YAML`.
 */
import { Result } from "better-result";
import { parse as parseYaml } from "yaml";

import type { ParsedCompose, ParsedComposeService } from "./types";

import { isObj, normalizeService } from "./normalize";

class ComposeParseError extends Error {
  /** 1-based line of the YAML syntax error, when the parser reports one. */
  line?: number;
  column?: number;
  constructor(message: string, line?: number, column?: number) {
    super(message);
    this.name = "ComposeParseError";
    this.line = line;
    this.column = column;
  }
}

/** Build a `ComposeParseError` from a thrown `yaml` parse error message. The
 *  message reliably embeds "at line N, column M" — parse it from there.
 *  (`Result.try` wraps the thrown error, so `linePos`/instanceof aren't
 *  reliable; the message survives.) Drops the wrapper prefix and the multi-line
 *  code snippet that follows the colon. */
function yamlParseError(rawMessage: string): ComposeParseError {
  const full = rawMessage.replace(/^Unhandled exception:\s*/i, "");
  const m = full.match(/at line (\d+),? *column (\d+)/i);
  const message = full.split("\n")[0]?.replace(/:\s*$/, "") ?? full;
  return new ComposeParseError(
    `Invalid YAML: ${message}`,
    m?.[1] ? Number(m[1]) : undefined,
    m?.[2] ? Number(m[2]) : undefined,
  );
}

/** Normalize each entry of the `services` map; non-mapping entries are skipped
 *  with a warning. */
function collectServices(
  servicesMap: Record<string, unknown>,
  warnings: string[],
): ParsedComposeService[] {
  const services: ParsedComposeService[] = [];
  for (const [name, svc] of Object.entries(servicesMap)) {
    if (!isObj(svc)) {
      warnings.push(`service "${name}" is not a mapping — skipped`);
      continue;
    }
    services.push(normalizeService(name, svc, warnings));
  }
  return services;
}

export function parseCompose(yaml: string): Result<ParsedCompose, ComposeParseError> {
  // The `yaml` package resolves anchors + `<<` merge keys (which compose uses
  // and Bun.YAML mishandles) and gives ACCURATE line/column on errors (Bun's
  // are bogus — constant regardless of input).
  const raw = Result.try(() => parseYaml(yaml, { merge: true }) as unknown);
  if (raw.isErr()) {
    return Result.err(yamlParseError(raw.error.message));
  }
  if (!isObj(raw.value)) {
    return Result.err(new ComposeParseError("Compose file must be a mapping"));
  }
  const doc = raw.value;
  if (!isObj(doc.services)) {
    return Result.err(new ComposeParseError("Compose file has no `services` map"));
  }

  const warnings: string[] = [];
  const services = collectServices(doc.services, warnings);

  if (services.length === 0) {
    return Result.err(new ComposeParseError("No services defined"));
  }
  const invalid = services.find((s) => !s.image && !s.build);
  if (invalid) {
    return Result.err(
      new ComposeParseError(`Service "${invalid.name}" must declare an \`image\` or a \`build\``),
    );
  }
  if (doc.secrets) warnings.push("top-level `secrets` are not supported yet");
  if (doc.configs) warnings.push("top-level `configs` are not supported yet");

  return Result.ok({
    name: typeof doc.name === "string" ? doc.name : null,
    services,
    volumeNames: isObj(doc.volumes) ? Object.keys(doc.volumes) : [],
    networkNames: isObj(doc.networks) ? Object.keys(doc.networks) : [],
    warnings,
  });
}
