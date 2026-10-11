/**
 * The bulk editor's apply path: one atomic bulkReplace per selected env: the
 * calls are independent (each targets a distinct env) so they run
 * concurrently; failures are collected so a partial failure reports exactly
 * which envs missed. Split from `variables-bulk-edit.tsx` so the dialog stays
 * a form shell within the file-size budget.
 */

import type { TFunction } from "i18next";

import { ORPCError } from "@orpc/client";
import { Result } from "better-result";

import { orpc } from "@/shared/server/orpc";

import type { ParsedVar } from "./variables-dotenv";
import type { EnvironmentRef } from "./variables-types";

export interface BulkApplyResult {
  applied: EnvironmentRef[];
  /** `conflict`: refused because that env's variables changed since the
   *  editor loaded them; nothing was written there. */
  failed: { env: EnvironmentRef; message: string; conflict: boolean }[];
}

export const envLabel = (env: EnvironmentRef): string => env.name || env.slug;

export async function runBulkApply({
  projectId,
  targets,
  vars,
  fallbackMessage,
  expectedVersions = {},
}: {
  projectId: string;
  targets: EnvironmentRef[];
  vars: ParsedVar[];
  fallbackMessage: string;
  /** Per env id: the version of the set the editor loaded. The env being
   *  edited carries one; the other "Apply to" targets replace on purpose. */
  expectedVersions?: Record<string, string>;
}): Promise<BulkApplyResult> {
  const applied: EnvironmentRef[] = [];
  const failed: BulkApplyResult["failed"] = [];
  const results = await Promise.all(
    targets.map(
      async (
        target,
      ): Promise<{ target: EnvironmentRef; message: string | null; conflict: boolean }> => {
        const expectedVersion = expectedVersions[target.id];
        const sent = await Result.tryPromise({
          try: async () =>
            orpc.project.envVar.bulkReplace.call({
              projectId,
              environmentId: target.id,
              vars: vars.map((p) => ({ key: p.key, value: p.value, isSecret: p.isSecret })),
              expectedVersion,
            }),
          catch: (err: unknown) => err,
        });
        if (sent.isOk()) return { target, message: null, conflict: false };
        const err = sent.error;
        return {
          target,
          message: err instanceof Error ? err.message : fallbackMessage,
          conflict: err instanceof ORPCError && err.code === "CONFLICT",
        };
      },
    ),
  );
  for (const { target, message, conflict } of results) {
    if (message === null) applied.push(target);
    else failed.push({ env: target, message, conflict });
  }
  return { applied, failed };
}

/** The toast for an apply that missed some environments. */
export function bulkFailureText(
  t: TFunction,
  applied: BulkApplyResult["applied"],
  failed: BulkApplyResult["failed"],
): string {
  const suffix =
    applied.length > 0
      ? t("variables.appliedSuffix", { names: applied.map(envLabel).join(", ") })
      : "";
  return (
    t("variables.failedToast", {
      names: failed.map((f) => envLabel(f.env)).join(", "),
      message: failed[0]?.message ?? "",
    }) + suffix
  );
}
