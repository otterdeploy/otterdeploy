/**
 * `compose.listVariables` / `setVariable` / `deleteVariable`: a stack's OWN
 * variables. Split out of index.ts to keep the router module under
 * the line cap; spread back into `composeRouter`.
 *
 * Every write lands on the stack and nowhere else: the project bag is the
 * project's, and a same-named project variable keeps reaching every other
 * stack and service that reads it. Values take effect on the
 * stack's next deploy, like an edit to its compose file.
 */
import type { JsonObject } from "@otterdeploy/shared/json";

import { isSecretKey } from "@otterdeploy/shared/env-var-kind";

import { projectScopedProcedure, requirePermission } from "../..";
import { recordSecretMapChanges } from "../../audit/changes";
import { parseCompose } from "../../stack/compose";
import { getProjectById } from "../project/queries";
import { collectFileVarRefs, collectVarRefs, type ComposeVarRef } from "./env";
import { type ComposeRecord, getComposeRecordInOrg } from "./queries";
import {
  deleteStackEnvVar,
  listProjectEnvKeys,
  listStackEnvVars,
  type StackEnvVarRow,
  upsertStackEnvVar,
} from "./stack-env";

/** Every `${VAR}` the stack's stored files reference: the compose file, plus
 *  each supporting file it interpolates. A git stack that has not built yet
 *  has no stored file and so no known refs. */
function stackVarRefs(rec: ComposeRecord): ComposeVarRef[] {
  const byName = new Map<string, ComposeVarRef>();
  const add = (ref: ComposeVarRef) => {
    const prev = byName.get(ref.name);
    if (!prev || (prev.default == null && ref.default != null)) byName.set(ref.name, ref);
  };
  const content = rec.compose.composeContent;
  const parsed = content ? parseCompose(content) : null;
  if (parsed?.isOk()) collectVarRefs(parsed.value).forEach(add);
  for (const file of rec.compose.files) {
    if (file.interpolate) collectFileVarRefs(file.content).forEach(add);
  }
  return [...byName.values()];
}

/** Keys of the project bag the stack falls back to (its environment's). */
async function projectKeysForStack(rec: ComposeRecord): Promise<Set<string>> {
  const project = await getProjectById(rec.resource.projectId);
  const environmentId = rec.resource.environmentId ?? project?.environmentId ?? null;
  if (!environmentId) return new Set();
  return listProjectEnvKeys({ projectId: rec.resource.projectId, environmentId });
}

/** A stored row as the API shows it: sealed plaintext never leaves. */
function stackVariableView(
  row: Pick<StackEnvVarRow, "key" | "value" | "isSecret" | "sealed">,
  projectKeys: ReadonlySet<string>,
) {
  return {
    key: row.key,
    scope: "stack" as const,
    value: row.sealed ? "" : row.value,
    isSecret: row.isSecret || row.sealed,
    sealed: row.sealed,
    overridesProject: projectKeys.has(row.key),
  };
}

/** A file ref the stack does not set itself, and where it resolves from. */
function inheritedVariableView(ref: ComposeVarRef, projectKeys: ReadonlySet<string>) {
  const scope = projectKeys.has(ref.name)
    ? ("project" as const)
    : ref.default != null
      ? ("default" as const)
      : ("missing" as const);
  return {
    key: ref.name,
    scope,
    value: "",
    isSecret: isSecretKey(ref.name),
    sealed: false,
    overridesProject: false,
  };
}

/** Key names only, for the audit diff: no value reaches the audit row. */
function keyMarkers(rows: ReadonlyArray<{ key: string }>): JsonObject {
  const out: JsonObject = {};
  for (const row of rows) out[row.key] = "set";
  return out;
}

export const composeVariablesRouter = {
  listVariables: projectScopedProcedure.compose.listVariables.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", kind: "compose", id: input.resourceId },
      });
      const rec = await getComposeRecordInOrg(context.activeOrganizationId, input);
      if (!rec) throw errors.NOT_FOUND();
      const [own, projectKeys] = await Promise.all([
        listStackEnvVars(rec.resource.id),
        projectKeysForStack(rec),
      ]);
      const ownKeys = new Set(own.map((r) => r.key));
      const inherited = stackVarRefs(rec)
        .filter((ref) => !ownKeys.has(ref.name))
        .map((ref) => inheritedVariableView(ref, projectKeys));
      return [...own.map((row) => stackVariableView(row, projectKeys)), ...inherited].sort((a, b) =>
        a.key.localeCompare(b.key),
      );
    },
  ),

  setVariable: requirePermission({ service: ["update"] }).compose.setVariable.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", kind: "compose", id: input.resourceId },
        envKey: input.key,
      });
      const rec = await getComposeRecordInOrg(context.activeOrganizationId, input);
      if (!rec) throw errors.NOT_FOUND();
      const before = keyMarkers(await listStackEnvVars(rec.resource.id));
      const row = await upsertStackEnvVar({
        stackResourceId: rec.resource.id,
        key: input.key,
        value: input.value,
        isSecret: input.isSecret ?? isSecretKey(input.key),
        sealed: input.sealed,
      });
      // `written` differs from `set`, so an existing key reads as a replace.
      recordSecretMapChanges(context, { before, after: { ...before, [input.key]: "written" } });
      return stackVariableView(row, await projectKeysForStack(rec));
    },
  ),

  deleteVariable: requirePermission({ service: ["update"] }).compose.deleteVariable.handler(
    async ({ input, context, errors }) => {
      context.log.set({
        target: { type: "resource", kind: "compose", id: input.resourceId },
        envKey: input.key,
      });
      const rec = await getComposeRecordInOrg(context.activeOrganizationId, input);
      if (!rec) throw errors.NOT_FOUND();
      const before = keyMarkers(await listStackEnvVars(rec.resource.id));
      await deleteStackEnvVar({ stackResourceId: rec.resource.id, key: input.key });
      const after = { ...before };
      delete after[input.key];
      recordSecretMapChanges(context, { before, after });
      return { ok: true };
    },
  ),
};
