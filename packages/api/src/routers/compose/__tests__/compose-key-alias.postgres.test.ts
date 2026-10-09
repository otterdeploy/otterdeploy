/**
 * Against a migrated Postgres: a stack child's spec answers to
 * its compose key when the stored hostname had to change it.
 *
 * Plausible CE dials `plausible_db:5432` and `plausible_events_db:8123` from
 * its built-in defaults, not from env the platform could repoint. The child
 * was stored as `plausible-db`, so those names were nxdomain and the app
 * crash-looped. The spec is built from the ROW, so this
 * drives `buildSwarmSpec` on real children.
 */
import { describe, expect, it } from "vite-plus/test";

import { seedOrganization, seedProject, seedService, uniq } from "../../../__tests__/postgres-seed";
import { getServiceRecord } from "../../service/queries/service";
import { buildSwarmSpec } from "../../service/spec";
import { createComposeRecord } from "../queries";

async function seedStackChild(composeService: string, hostname: string) {
  const organizationId = await seedOrganization("alias");
  const { projectId, slug, mainEnvironmentId } = await seedProject(organizationId);
  const stack = await createComposeRecord({
    projectId,
    environmentId: mainEnvironmentId,
    name: `plausible-${uniq()}`,
    source: "git",
    composeContent: `services:\n  ${composeService}:\n    image: postgres:16-alpine\n`,
    stackName: `plausible-${uniq()}`,
    services: [],
  });
  const child = await seedService({
    projectId,
    environmentId: mainEnvironmentId,
    name: `plausible-${composeService.replaceAll("_", "-")}`,
    hostname,
    stackId: stack.resource.id,
    composeService,
  });
  const record = await getServiceRecord(projectId, child.resourceId);
  if (!record) throw new Error("child service vanished");
  return buildSwarmSpec(record, {}, slug);
}

describe("a compose key that is not a DNS label still resolves", () => {
  it("plausible_db is an alias of the child stored as plausible-db", async () => {
    const spec = await seedStackChild("plausible_db", "plausible-db");
    expect(spec.internalHostname).toBe("plausible-db");
    expect(spec.composeKeyAlias).toBe("plausible_db");
  });

  it("a child renamed past another stack's label does not take the key", async () => {
    const spec = await seedStackChild("plausible_db", "plausible-plausible-db");
    expect(spec.composeKeyAlias).toBeNull();
  });

  it("a key that already is its hostname adds nothing", async () => {
    const spec = await seedStackChild("db", "db");
    expect(spec.composeKeyAlias).toBeNull();
  });
});
