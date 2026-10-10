/**
 * Against a migrated Postgres: a compose child's `stop_grace_period` and
 * `stop_signal` survive the trip file -> service row -> runtime spec, and a
 * reconcile that drops them from the file clears them. Without the columns a
 * database child was always stopped with docker's default 10 s and killed
 * mid-checkpoint (n8n's Postgres: "could not locate a valid checkpoint record").
 */
import { hasPrefix, type Id } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import { seedOrganization, seedProject, seedService } from "../../../__tests__/postgres-seed";
import { parseCompose } from "../../../stack/compose";
import { getServiceRecord, updateServiceRecord } from "../../service/queries/service";
import { buildSwarmSpec } from "../../service/spec";
import { toServiceFields } from "../reconcile-map";

const FILE = `
services:
  db:
    image: postgres:17
    stop_grace_period: 1m30s
    stop_signal: sigint
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes:
  pgdata:
`;

const BARE = `
services:
  db:
    image: postgres:17
`;

/** Brand a test ID through the real prefix guard instead of casting. */
function brandId<P extends string>(value: string, prefix: P): Id<P> {
  if (!hasPrefix(value, prefix)) throw new Error(`test id "${value}" lacks "${prefix}"`);
  return value;
}

function mapped(yaml: string) {
  const parsed = parseCompose(yaml);
  if (parsed.isErr()) throw new Error(parsed.error.message);
  const svc = parsed.value.services[0];
  if (!svc) throw new Error("no service");
  return toServiceFields(
    svc,
    {
      projectId: brandId("prj_x", "prj"),
      placementServerId: null,
      organizationId: brandId("org_x", "org"),
      exposedSeeds: new Map(),
      stackResourceId: brandId("res_x", "res"),
      projectSlug: "fx",
      stackName: "stack",
      projectVars: {},
      builtImages: {},
    },
    "postgres:17",
  );
}

describe("a stack child keeps its stop policy", () => {
  it("the file's stop_grace_period and stop_signal reach the runtime spec", async () => {
    const organizationId = await seedOrganization("stop");
    const { projectId, slug, mainEnvironmentId } = await seedProject(organizationId);
    const child = await seedService({ projectId, environmentId: mainEnvironmentId, name: "db" });

    await updateServiceRecord(child.resourceId, mapped(FILE).fields);
    const record = await getServiceRecord(projectId, child.resourceId);
    if (!record) throw new Error("child vanished");
    const spec = await buildSwarmSpec(record, {}, slug);
    expect(spec.stopGracePeriodMs).toBe(90_000);
    expect(spec.stopSignal).toBe("SIGINT");
  });

  it("a file that drops them clears them on the next reconcile", async () => {
    const organizationId = await seedOrganization("stop");
    const { projectId, slug, mainEnvironmentId } = await seedProject(organizationId);
    const child = await seedService({ projectId, environmentId: mainEnvironmentId, name: "db" });

    await updateServiceRecord(child.resourceId, mapped(FILE).fields);
    await updateServiceRecord(child.resourceId, mapped(BARE).fields);
    const record = await getServiceRecord(projectId, child.resourceId);
    if (!record) throw new Error("child vanished");
    const spec = await buildSwarmSpec(record, {}, slug);
    expect(spec.stopGracePeriodMs).toBeNull();
    expect(spec.stopSignal).toBeNull();
  });
});
