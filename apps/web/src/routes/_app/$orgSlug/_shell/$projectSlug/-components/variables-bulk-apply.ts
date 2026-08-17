/**
 * The bulk editor's apply path: one atomic bulkReplace per selected env — the
 * calls are independent (each targets a distinct env) so they run
 * concurrently; failures are collected so a partial failure reports exactly
 * which envs missed. Split from `variables-bulk-edit.tsx` so the dialog stays
 * a form shell within the file-size budget.
 */

import { orpc } from "@/shared/server/orpc";

import type { ParsedVar } from "./variables-dotenv";
import type { EnvironmentRef } from "./variables-types";

export interface BulkApplyResult {
  applied: EnvironmentRef[];
  failed: { env: EnvironmentRef; message: string }[];
}

export const envLabel = (env: EnvironmentRef): string => env.name || env.slug;

export async function runBulkApply({
  projectId,
  targets,
  vars,
  fallbackMessage,
}: {
  projectId: string;
  targets: EnvironmentRef[];
  vars: ParsedVar[];
  fallbackMessage: string;
}): Promise<BulkApplyResult> {
  const applied: EnvironmentRef[] = [];
  const failed: { env: EnvironmentRef; message: string }[] = [];
  const results = await Promise.all(
    targets.map(
      async (target): Promise<{ target: EnvironmentRef; message: string | null }> => {
        try {
          await orpc.project.envVar.bulkReplace.call({
            projectId,
            environmentId: target.id,
            vars: vars.map((p) => ({ key: p.key, value: p.value, isSecret: p.isSecret })),
          });
          return { target, message: null };
        } catch (err) {
          return { target, message: err instanceof Error ? err.message : fallbackMessage };
        }
      },
    ),
  );
  for (const { target, message } of results) {
    if (message === null) applied.push(target);
    else failed.push({ env: target, message });
  }
  return { applied, failed };
}
