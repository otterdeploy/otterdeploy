import type { ProjectId } from "@otterdeploy/shared/id";

import { projectDir } from "@otterdeploy/shared/paths";
import { log as globalLog } from "evlog";
/**
 * Disaster-recovery escape hatch — Phase 4 of docs/designs/data-folder.md.
 *
 * On every successful manifest apply we render the project's CURRENT deployed
 * state to two files under `projects/<projectId>/`:
 *
 *   - `compose.yml`       — a plain Docker Compose file you can `docker compose
 *                           -f compose.yml up` BY HAND if the control plane
 *                           (Postgres) is gone. NOT the deploy path — the
 *                           platform always deploys via the `runtime()` driver;
 *                           this is a human break-glass artifact only.
 *   - `otterdeploy.json`  — the rendered StackFile as JSON: a machine-readable
 *                           snapshot for audit / re-import into a fresh control
 *                           plane.
 *
 * Like the rest of the data folder this is BEST-EFFORT and OPTIONAL: it no-ops
 * when `/data` isn't writable (dev), and a write failure never fails the apply.
 * Losing it costs you a convenience, never a deploy.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { renderProjectFromRows, toComposeYaml } from "../stack/render";
import { dataRootAvailable } from "./data-dir";

/**
 * Refresh a project's DR escape hatch from its current DB rows. Renders once
 * (same path as the `manifest.export` procedure) and writes both files. Never
 * throws — failures are logged and swallowed so they can't break an apply.
 */
export async function writeProjectEscapeHatch(projectId: ProjectId): Promise<void> {
  if (!(await dataRootAvailable())) return;
  try {
    const file = await renderProjectFromRows(projectId);
    const dir = projectDir(projectId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await Promise.all([
      writeFile(join(dir, "compose.yml"), toComposeYaml(file), { mode: 0o600 }),
      writeFile(join(dir, "otterdeploy.json"), `${JSON.stringify(file, null, 2)}\n`, {
        mode: 0o600,
      }),
    ]);
  } catch (cause) {
    globalLog.warn({
      escapeHatch: { event: "write-failed", projectId },
      error: cause instanceof Error ? cause.message : String(cause),
    } as Record<string, unknown>);
  }
}
