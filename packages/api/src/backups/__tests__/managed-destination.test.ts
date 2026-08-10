/**
 * The platform-managed local destination, and the fan-out filter that makes
 * `disabled` mean something.
 *
 * Both rules exist to close the same gap: a fresh install used to have zero
 * backup destinations, so nothing could be scheduled until an operator invented
 * a host path by hand. The managed row removes that, and the fan-out filter is
 * what keeps "disable" honest once the row can never be deleted.
 */
import type { BackupDestinationId, OrganizationId } from "@otterdeploy/shared/id";

import { managedBackupRepoRoot } from "@otterdeploy/shared/paths";
import { describe, expect, it } from "vite-plus/test";

import { managedLocalConfig } from "../managed-destination";
import { runnableDestinationIds } from "../schedule-db";

const org = (id: string) => id as OrganizationId;
const dest = (id: string) => id as BackupDestinationId;
const row = (id: string, status: string) => ({ id: dest(id), status });

describe("managedLocalConfig", () => {
  it("roots the repo at the platform-owned path, not a user-supplied one", () => {
    const config = managedLocalConfig(org("org_a"));
    expect(config.path).toBe(managedBackupRepoRoot());
  });

  it("namespaces by org via `prefix`, which deriveRepoId already threads", () => {
    // Two orgs on one install must not share a repo root, or one org's `forget
    // --prune` could reach another's snapshots.
    expect(managedLocalConfig(org("org_a")).prefix).toBe("org_a");
    expect(managedLocalConfig(org("org_b")).prefix).toBe("org_b");
    expect(managedLocalConfig(org("org_a")).path).toBe(managedLocalConfig(org("org_b")).path);
  });

  it("satisfies the `local` required-config contract (path is non-empty)", () => {
    // missingConfigKeys("local", ...) requires `path`; a managed row that
    // failed this would be unusable the moment a run touched it.
    const config = managedLocalConfig(org("org_a"));
    expect(typeof config.path).toBe("string");
    expect((config.path as string).length).toBeGreaterThan(0);
  });
});

describe("runnableDestinationIds", () => {
  it("keeps active destinations in their original order", () => {
    const ids = [dest("d_c"), dest("d_a"), dest("d_b")];
    const rows = [row("d_a", "active"), row("d_b", "active"), row("d_c", "active")];
    expect(runnableDestinationIds(ids, rows)).toEqual(ids);
  });

  it("drops disabled destinations. This is what makes `disable` real", () => {
    const ids = [dest("d_local"), dest("d_s3")];
    const rows = [row("d_local", "disabled"), row("d_s3", "active")];
    expect(runnableDestinationIds(ids, rows)).toEqual([dest("d_s3")]);
  });

  it("keeps `degraded` destinations, health, not operator intent", () => {
    const ids = [dest("d_s3")];
    expect(runnableDestinationIds(ids, [row("d_s3", "degraded")])).toEqual([dest("d_s3")]);
  });

  it("drops ids with no row: destinationIds is FK-less jsonb and can dangle", () => {
    const ids = [dest("d_gone"), dest("d_live")];
    expect(runnableDestinationIds(ids, [row("d_live", "active")])).toEqual([dest("d_live")]);
  });

  it("returns empty when every destination is disabled", () => {
    // The scheduler treats an empty result as `failed` rather than `queued`, so
    // a schedule with nothing to write to reads as broken instead of pending.
    const ids = [dest("d_a"), dest("d_b")];
    const rows = [row("d_a", "disabled"), row("d_b", "disabled")];
    expect(runnableDestinationIds(ids, rows)).toEqual([]);
  });

  it("handles an empty schedule", () => {
    expect(runnableDestinationIds([], [row("d_a", "active")])).toEqual([]);
  });
});
