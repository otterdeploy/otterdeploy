/**
 * A stack's `env_file` targets, merged under each service's `environment`.
 *
 * Read wherever the stack's files actually are: the materialized tree of a
 * multi-file inline stack, or the build checkout of a git stack (the builder
 * hands deployCompose the compose file's directory). Git stacks used to skip
 * this entirely, so Immich's server, which takes its database password from
 * `env_file: .env`, started on the image default while its Postgres was
 * initialised with the stack's password.
 *
 * Two rules compose has that we now keep:
 * - a REQUIRED env_file that is not there is an error, not a silent skip.
 *   Compose refuses to start such a service; deploying it anyway produced a
 *   container missing half its configuration, with nothing in any log;
 * - `.env` beside the compose file is the stack's own variable file: compose
 *   reads it to interpolate `${VAR}`, and upstream files point `env_file` at
 *   it too (Immich does, and ships only `example.env`, to be copied and
 *   edited). On the platform the stack's VARIABLES are that file: they are
 *   what the operator filled in where a compose user edits `.env`. So when
 *   `.env` is not in the tree, a service naming it gets the variables the
 *   stack's file interpolates, from the same bag the interpolation reads.
 */
import type { ParsedCompose, ParsedEnvFile } from "../../stack/compose";

import { readEnvFile } from "../../lib/compose-materialize";
import { collectVarRefs } from "./env";

/** Where a stack's env_file targets live, as an operator would name it. */
export type EnvFileHome = "repo" | "stack files";

export interface EnvFileOutcome {
  /** Lines for the deployment log: optional files skipped, `.env` stood in. */
  notes: string[];
  /** Required env_file targets that are not there, per service. */
  missing: Array<{ service: string; path: string }>;
}

/** True for compose's project env file: `.env` beside the compose file. */
function isStackDotEnv(file: ParsedEnvFile): boolean {
  return file.path.replace(/^(\.\/)+/, "") === ".env";
}

/**
 * The stack's variables as its `.env` would hold them: every `${VAR}` its
 * compose file interpolates that has a value.
 */
function stackDotEnv(
  parsed: ParsedCompose,
  stackVars: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of collectVarRefs(parsed)) {
    const value = stackVars[ref.name];
    if (value !== undefined) out[ref.name] = value;
  }
  return out;
}

/**
 * Merge each service's env_file values under its own `environment` (which
 * wins, as in compose), in place. `dir` undefined means the stack has no files
 * on disk at all (a single-file stack), so every target is absent.
 */
export async function applyEnvFiles(
  parsed: ParsedCompose,
  input: { dir: string | undefined; home: EnvFileHome; stackVars: Record<string, string> },
): Promise<EnvFileOutcome> {
  const outcome: EnvFileOutcome = { notes: [], missing: [] };
  for (const svc of parsed.services) {
    let fromFiles: Record<string, string> = {};
    for (const file of svc.envFile) {
      const read = input.dir ? await readEnvFile(file.path, input.dir) : null;
      if (read) {
        fromFiles = { ...fromFiles, ...read };
      } else if (isStackDotEnv(file)) {
        const vars = stackDotEnv(parsed, input.stackVars);
        fromFiles = { ...fromFiles, ...vars };
        outcome.notes.push(
          `${svc.name}: no .env in the ${input.home}; using the stack's variables (${Object.keys(vars).sort().join(", ") || "none set"})`,
        );
      } else if (file.required) {
        outcome.missing.push({ service: svc.name, path: file.path });
      } else {
        outcome.notes.push(`${svc.name}: optional env_file ${file.path} not in the ${input.home}`);
      }
    }
    svc.env = { ...fromFiles, ...svc.env };
  }
  return outcome;
}

/** The deploy error for required env_file targets that are not there. */
export function missingEnvFilesMessage(
  missing: EnvFileOutcome["missing"],
  home: EnvFileHome,
): string {
  const list = missing.map((m) => `${m.service} → ${m.path}`).join(", ");
  return (
    `These env_file targets are not in the ${home}: ${list}. ` +
    "Compose refuses a missing env_file too. Add the file, or mark the entry `required: false`."
  );
}
