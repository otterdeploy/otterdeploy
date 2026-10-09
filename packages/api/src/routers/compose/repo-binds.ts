/**
 * A git stack's bind mounts, staged out of its build checkout.
 * See stageRepoBindSources for why the checkout itself cannot be mounted.
 */
import { composeRepoBindDir, type ResourceRef } from "@otterdeploy/shared/paths";
import { Result } from "better-result";

import type { ParsedCompose } from "../../stack/compose";

import { stageRepoBindSources } from "../../lib/compose-materialize";

export interface GitStackBinds {
  /** Where the staged sources live: the reconcile resolves binds against it. */
  stackDir: string;
  /** The compose sources that were staged. Only these are mounted. */
  sources: ReadonlySet<string>;
  /** Deploy-log lines saying what was mounted and what was not. */
  notes: string[];
}

/** {@link stageGitStackFiles}, with a copy that failed (a full disk, a
 *  permission) as a message naming what went wrong. */
export async function stageGitStackBinds(
  parsed: ParsedCompose,
  checkoutDir: string,
  ref: ResourceRef,
): Promise<Result<GitStackBinds, Error>> {
  return Result.tryPromise({
    try: () => stageGitStackFiles(parsed, checkoutDir, ref),
    catch: (cause) =>
      new Error(
        `Could not copy this stack's bind mounts out of the repo: ${cause instanceof Error ? cause.message : String(cause)}`,
      ),
  });
}

async function stageGitStackFiles(
  parsed: ParsedCompose,
  checkoutDir: string,
  ref: ResourceRef,
): Promise<GitStackBinds> {
  const sources = parsed.services.flatMap((svc) =>
    svc.volumes.flatMap((v) => (v.type === "bind" && v.source ? [v.source] : [])),
  );
  const stackDir = composeRepoBindDir(ref);
  const { staged, absent } = await stageRepoBindSources(sources, checkoutDir, stackDir);
  const notes: string[] = [];
  if (staged.size > 0) notes.push(`Mounted from the repo: ${[...staged].join(", ")}`);
  if (absent.length > 0) {
    notes.push(
      `Not mounted, not a file or folder beside the compose file in the repo: ${absent.join(", ")}`,
    );
  }
  return { stackDir, sources: staged, notes };
}
