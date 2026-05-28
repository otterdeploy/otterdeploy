/**
 * Save handler for `project.stack.save`.
 *
 * Parses the incoming YAML, validates it against the StackFile schema,
 * and writes it to the `project.stackFile` column with an optimistic
 * lock on `stackFileVersion`. Returns the new version so the client can
 * track concurrent edits.
 */

import { db } from "@otterdeploy/db";
import { project } from "@otterdeploy/db/schema/project";
import { and, eq } from "drizzle-orm";
import { Result, TaggedError } from "better-result";

import { type Id, ID_PREFIX as IDP } from "@otterdeploy/shared/id";

import { stackFileSchema } from "../../stack";

import { ProjectNotFoundError, type ProjectId } from "./errors";
import { getProjectInOrg } from "./queries";

type OrgId = Id<typeof IDP.organization>;

export class StackVersionMismatchError extends TaggedError(
  "StackVersionMismatchError",
)<{
  message: string;
  expected: number;
  actual: number;
}>() {
  constructor(args: { expected: number; actual: number }) {
    super({
      expected: args.expected,
      actual: args.actual,
      message: `stackFile version mismatch: expected ${args.expected}, found ${args.actual}. Reload the editor and reapply your changes.`,
    });
  }
}

export class StackParseError extends TaggedError("StackParseError")<{
  message: string;
}>() {
  constructor(args: { reason: string }) {
    super({ message: `stackFile parse failed: ${args.reason}` });
  }
}

export type SaveStackError =
  | ProjectNotFoundError
  | StackVersionMismatchError
  | StackParseError;

export interface SaveStackResult {
  version: number;
}

export async function saveProjectStack(input: {
  projectId: ProjectId;
  organizationId: OrgId;
  yaml: string;
  expectedVersion: number;
}): Promise<Result<SaveStackResult, SaveStackError>> {
  const row = await getProjectInOrg({
    projectId: input.projectId,
    organizationId: input.organizationId,
  });
  if (!row) {
    return Result.err(new ProjectNotFoundError({ projectId: input.projectId }));
  }

  // Bun.YAML.parse throws on syntactically invalid YAML — wrap so callers
  // get a typed Result instead of an exception.
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(input.yaml);
  } catch (e) {
    return Result.err(
      new StackParseError({
        reason: e instanceof Error ? e.message : String(e),
      }),
    );
  }

  const validated = stackFileSchema.safeParse(parsed);
  if (!validated.success) {
    return Result.err(
      new StackParseError({
        reason: validated.error.issues[0]?.message ?? "schema mismatch",
      }),
    );
  }

  const updated = await db
    .update(project)
    .set({
      stackFile: input.yaml,
      stackFileVersion: input.expectedVersion + 1,
    })
    .where(
      and(
        eq(project.id, input.projectId),
        eq(project.stackFileVersion, input.expectedVersion),
      ),
    )
    .returning({ stackFileVersion: project.stackFileVersion });

  if (updated.length === 0) {
    const [current] = await db
      .select({ stackFileVersion: project.stackFileVersion })
      .from(project)
      .where(eq(project.id, input.projectId))
      .limit(1);
    return Result.err(
      new StackVersionMismatchError({
        expected: input.expectedVersion,
        actual: current?.stackFileVersion ?? -1,
      }),
    );
  }

  const next = updated[0]?.stackFileVersion;
  if (next === undefined) {
    return Result.err(
      new StackVersionMismatchError({ expected: input.expectedVersion, actual: -1 }),
    );
  }
  return Result.ok({ version: next });
}
