/**
 * The platform-managed local destination, and the fan-out filter that makes
 * `disabled` mean something.
 *
 * Both rules exist to close the same gap: a fresh install used to have zero
 * backup destinations, so nothing could be scheduled until an operator invented
 * a host path by hand. The managed row removes that, and the fan-out filter is
 * what keeps "disable" honest once the row can never be deleted.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { orgBackupRepoRoot } from "@otterdeploy/shared/paths";
import { describe, expect, it } from "vite-plus/test";

import { managedLocalConfig } from "../managed-destination";
import { runnableDestinationIds } from "../schedule-db";

const org = (id: string) => idSchema.organization.parse(id);
const dest = (id: string) => idSchema.backupDestination.parse(id);
const row = (id: string, status: string) => ({ id: dest(id), status });

describe("managedLocalConfig", () => {
  it("roots the repo at the org's platform-owned path, not a user-supplied one", () => {
    const config = managedLocalConfig(org("org_a"));
    expect(config.path).toBe(orgBackupRepoRoot(org("org_a")));
  });

  it("namespaces by org via the path itself — no `prefix` key", () => {
    // Two orgs on one install must not share a repo root, or one org's `forget
    // --prune` could reach another's snapshots. The namespace is the path
    // (`orgs/<org>/backups/`), so deriveRepoKey's bare-scope managed ids stay apart.
    const a = managedLocalConfig(org("org_a"));
    const b = managedLocalConfig(org("org_b"));
    expect(a.path).not.toBe(b.path);
    expect("prefix" in a).toBe(false);
  });

  it("satisfies the `local` required-config contract (path is non-empty)", () => {
    // missingConfigKeys("local", ...) requires `path`; a managed row that
    // failed this would be unusable the moment a run touched it.
    const config = managedLocalConfig(org("org_a"));
    expect(typeof config.path).toBe("string");
    expect(config.path.length).toBeGreaterThan(0);
  });
});

describe("runnableDestinationIds", () => {
  it("keeps active destinations in their original order", () => {
    const ids = [dest("bdst_c"), dest("bdst_a"), dest("bdst_b")];
    const rows = [row("bdst_a", "active"), row("bdst_b", "active"), row("bdst_c", "active")];
    expect(runnableDestinationIds(ids, rows)).toEqual(ids);
  });

  it("drops disabled destinations — this is what makes `disable` real", () => {
    const ids = [dest("bdst_local"), dest("bdst_s3")];
    const rows = [row("bdst_local", "disabled"), row("bdst_s3", "active")];
    expect(runnableDestinationIds(ids, rows)).toEqual([dest("bdst_s3")]);
  });

  it("keeps `degraded` destinations — health, not operator intent", () => {
    const ids = [dest("bdst_s3")];
    expect(runnableDestinationIds(ids, [row("bdst_s3", "degraded")])).toEqual([dest("bdst_s3")]);
  });

  it("drops ids with no row: destinationIds is FK-less jsonb and can dangle", () => {
    const ids = [dest("bdst_gone"), dest("bdst_live")];
    expect(runnableDestinationIds(ids, [row("bdst_live", "active")])).toEqual([dest("bdst_live")]);
  });

  it("returns empty when every destination is disabled", () => {
    // The scheduler treats an empty result as `failed` rather than `queued`, so
    // a schedule with nothing to write to reads as broken instead of pending.
    const ids = [dest("bdst_a"), dest("bdst_b")];
    const rows = [row("bdst_a", "disabled"), row("bdst_b", "disabled")];
    expect(runnableDestinationIds(ids, rows)).toEqual([]);
  });

  it("handles an empty schedule", () => {
    expect(runnableDestinationIds([], [row("bdst_a", "active")])).toEqual([]);
  });
});
