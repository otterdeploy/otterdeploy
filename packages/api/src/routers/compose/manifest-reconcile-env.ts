import type { ProjectId } from "@otterdeploy/shared/id";

import type { ComposeManifest } from "../../stack/manifest";
import type { ManifestProject } from "./manifest-reconcile";

import { upsertProjectEnvVar } from "../project/queries";
import { SECRETISH } from "./util";

/**
 * SEED the stack's `${VAR}` values as project variables so the compose
 * interpolation (and any later redeploy) resolves them. The manifest is the
 * source of truth for these at create time; thereafter they're owned by the
 * project's variable cascade.
 *
 * Seed, not write: an existing key keeps its value. Project variables are ONE
 * flat namespace shared by every stack in the project, and template variable
 * names are generic — `POSTGRES_PASSWORD`, `JWT_SECRET`, `SECRET_KEY`,
 * `NEXTAUTH_SECRET` are each wanted by a dozen templates. Writing
 * unconditionally meant installing (or reinstalling) one stack rotated a
 * credential another stack was running on, and rotated the reinstalled
 * stack's own credential out from under its surviving data volume.
 *
 * That second case is the one that actually bites, because it is invisible:
 * Postgres applies `POSTGRES_PASSWORD` only when it initialises an EMPTY data
 * directory ("Database directory appears to contain a database; Skipping
 * initialization"). Reinstall a stack whose volume survived and every config
 * surface — the shared bag, the db service, the app's DATABASE_URL — agrees
 * on a new password that the database itself never adopted. Four places agree
 * and all four are wrong; the only authority is the volume. Observed
 * 2026-08-29 on a live Postiz stack, which crash-looped on P1000 with
 * perfectly consistent configuration. See od-esjx.
 *
 * This is half the fix. The other half is giving stacks a scope of their own
 * so two templates cannot collide on a name at all (od-1w02).
 */
export async function persistManifestEnv(
  spec: ComposeManifest,
  projectId: ProjectId,
  project: ManifestProject,
): Promise<void> {
  if (!spec.env || !project.environmentId) return;
  for (const [key, value] of Object.entries(spec.env)) {
    if (!value) continue;
    await upsertProjectEnvVar({
      scope: { projectId, environmentId: project.environmentId },
      key,
      value,
      isSecret: SECRETISH.test(key),
      onlyIfAbsent: true,
    });
  }
}
