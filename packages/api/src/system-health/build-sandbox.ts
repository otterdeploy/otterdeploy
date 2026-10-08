/**
 * The isolated build sandbox's last known state (od-48w), as the builder
 * recorded it in `<DATA_ROOT>/platform/build-sandbox.json`.
 *
 * Tenant builds fail closed when the rootless sandbox cannot start, and the
 * builder says why in each refused build's log. This file is what makes the
 * same fact visible on System health without opening a build: one place that
 * says "builds are being refused, and here is the command that fixes it".
 */
import { buildSandboxStatusPath } from "@otterdeploy/shared/paths";
import { Result } from "better-result";
import { readFile } from "node:fs/promises";
import * as z from "zod";

import type { HealthRecommendation } from "./host-health";

export const buildSandboxStatusSchema = z.object({
  state: z.enum(["ready", "failed", "unisolated"]),
  reason: z.string().nullable(),
  image: z.string(),
  checkedAt: z.string(),
});

export type BuildSandboxStatus = z.infer<typeof buildSandboxStatusSchema>;

/** The recorded status, or null when there is none (no builder on this host
 *  yet, or a file that does not parse). */
export async function readBuildSandboxStatus(): Promise<BuildSandboxStatus | null> {
  const text = await Result.tryPromise(() => readFile(buildSandboxStatusPath(), "utf8"));
  if (text.isErr()) return null;
  const parsed = Result.try(() => buildSandboxStatusSchema.parse(JSON.parse(text.value)));
  return parsed.isOk() ? parsed.value : null;
}

/** The System health recommendation for a sandbox status. PURE. */
export function buildSandboxRecommendations(
  status: BuildSandboxStatus | null,
): HealthRecommendation[] {
  if (status?.state === "failed") {
    return [
      {
        id: "build-sandbox-down",
        severity: "critical",
        title: "Builds are being refused: the isolated build sandbox is not running",
        detail: `Tenant builds run in a rootless BuildKit sandbox and are refused rather than run unisolated on the host. Last check: ${status.reason ?? "no reason recorded"}`,
        action: null,
      },
    ];
  }
  if (status?.state === "unisolated") {
    return [
      {
        id: "build-sandbox-unisolated",
        severity: "warning",
        title: "Builds run without tenant isolation",
        detail:
          "BUILDER_ALLOW_UNISOLATED is set, so builds run on the host Docker daemon. A Dockerfile build there can reach the host. Only use this on a single-operator install that builds trusted code.",
        action: null,
      },
    ];
  }
  return [];
}
