/**
 * Inline-source compose create — split out of create.ts to keep that file
 * under the line cap. Handles single-file (pasted content) and multi-file
 * (files[] tree) stacks: parse, persist, then deploy directly — or, when the
 * file has `build:` services, enqueue the build worker (which materializes the
 * tree, builds each context, and deploys). See docs/designs/compose.md.
 */
import type { ProjectId, ResourceId } from "@otterdeploy/shared/id";
import type { RequestLogger } from "evlog";

import { Result } from "better-result";

import type {
  ComposeCreateFailure,
  ComposeCreateInput,
  ComposeCreateOutput,
  ComposeProject,
  ExposedSeed,
} from "./create";

import type { ParsedCompose } from "../../stack/compose/types";

import { parseCompose, summarizeCompose } from "../../stack/compose";
import { isUniqueViolation } from "../project/views";
import { enqueueInlineComposeBuild } from "./build-trigger";
import { deployCompose } from "./deploy";
import { createComposeRecord } from "./queries";
import { pickComposeFile, stackNameFor } from "./util";

const invalid = (message: string): ComposeCreateFailure => ({ reason: "invalid", message });

interface ResolvedInline {
  files: NonNullable<ComposeCreateInput["files"]>;
  composeContent: string;
  composePath: string | null;
  parsed: ParsedCompose;
  services: ReturnType<typeof summarizeCompose>;
  name: string;
}

/** Resolve the designated compose file (multi-file: one entry in `files`;
 *  single-file: the pasted `composeContent`), parse it, and derive the stack
 *  name. Keeps composeContent/composePath in sync with the designated file so
 *  every downstream reader parses the same string. */
function resolveInlineInput(input: ComposeCreateInput): Result<ResolvedInline, ComposeCreateFailure> {
  const files = input.files ?? [];
  const picked = files.length > 0 ? pickComposeFile(files, input.composePath) : null;
  const composeContent = picked?.content ?? input.composeContent;
  const composePath = picked?.path ?? input.composePath ?? null;
  if (!composeContent) {
    return Result.err(invalid("Compose file is empty"));
  }
  const parsed = parseCompose(composeContent);
  if (parsed.isErr()) {
    return Result.err(invalid(parsed.error.message));
  }
  const services = summarizeCompose(parsed.value);
  // Name from the user, else the file's `name:`, else its first service.
  const name =
    input.name?.trim() || parsed.value.name || parsed.value.services[0]?.name || "compose-stack";
  return Result.ok({ files, composeContent, composePath, parsed: parsed.value, services, name });
}

/** Inline source: parse + persist, then deploy (or enqueue a build). */
export async function createInlineCompose(
  input: ComposeCreateInput,
  project: ComposeProject,
  exposed: ExposedSeed[],
  log: RequestLogger,
): Promise<Result<ComposeCreateOutput, ComposeCreateFailure>> {
  const resolved = resolveInlineInput(input);
  if (resolved.isErr()) return Result.err(resolved.error);
  const { files, composeContent, composePath, parsed, services, name } = resolved.value;
  const stackName = stackNameFor(project.slug, name);

  const created = await Result.tryPromise({
    try: () =>
      createComposeRecord({
        projectId: input.projectId,
        name,
        source: "inline",
        composeContent,
        files,
        composePath,
        stackName,
        services,
        exposed,
      }),
    catch: (e) => (e instanceof Error ? e : new Error(String(e))),
  });
  if (created.isErr()) {
    if (isUniqueViolation(created.error)) return Result.err({ reason: "conflict" });
    throw created.error;
  }

  log.set({
    target: {
      type: "resource",
      kind: "compose",
      id: created.value.resource.id,
      projectId: input.projectId,
    },
  });

  const deploy = input.deploy
    ? await deployOrEnqueueInline({
        projectId: input.projectId,
        resourceId: created.value.resource.id,
        hasBuild: services.some((s) => s.hasBuild),
        composeContent,
        log,
      })
    : { ok: false, error: null as string | null, status: "created" };

  return Result.ok({
    resourceId: created.value.resource.id,
    services,
    warnings: parsed.warnings,
    deploy,
  });
}

/** Deploy an inline stack now, or — when it has `build:` services (no image
 *  yet) — route through the build worker, which materializes the file tree,
 *  builds each context, then deploys. */
async function deployOrEnqueueInline(args: {
  projectId: ProjectId;
  resourceId: ResourceId;
  hasBuild: boolean;
  composeContent: string;
  log: RequestLogger;
}): Promise<{ ok: boolean; error: string | null; status: string }> {
  if (args.hasBuild) {
    const enq = await enqueueInlineComposeBuild({
      projectId: args.projectId,
      resourceId: args.resourceId,
      composeContent: args.composeContent,
      reason: "create",
    });
    return enq.isOk()
      ? { ok: true, error: null, status: "building" }
      : { ok: false, error: enq.error, status: "failed" };
  }
  const d = await deployCompose(
    { projectId: args.projectId, resourceId: args.resourceId },
    "create",
    args.log,
  );
  return d.isOk()
    ? { ok: true, error: null, status: d.value.status }
    : { ok: false, error: d.error.message, status: "failed" };
}
