/**
 * Against a migrated Postgres: a git stack's bind mount from its
 * repo reaches the child it belongs to.
 *
 * A git stack deploys from the build worker with the checkout beside it
 * (`sourceDir`), and that checkout is deleted when the build ends. The binds
 * were dropped on the `!ctx.stackDir` guard, so n8n's Postgres initialised
 * without `init-data.sh` and the role n8n logs in as never existed. This
 * drives `deployCompose` the way the build worker does and
 * reads back the mounts the child was created with.
 */
import { db } from "@otterdeploy/db";
import { deployment } from "@otterdeploy/db/schema";
import { serviceResource } from "@otterdeploy/db/schema/project";
import { resourceDir } from "@otterdeploy/shared/paths";
import { eq } from "drizzle-orm";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, seedProject, uniq } from "../../../__tests__/postgres-seed";
import { listServiceMounts } from "../../service/queries/mounts";
import { deployCompose } from "../deploy";
import { createComposeRecord } from "../queries";

const { dataDir } = vi.hoisted(() => {
  const dir = `/tmp/od-git-binds-${process.pid}`;
  /* oxlint-disable node/no-process-env -- test env boundary: DATA_ROOT is captured at module load, and the rollout must fail fast instead of dialling a real Docker daemon */
  process.env.OTTERDEPLOY_DATA_DIR = dir;
  process.env.DOCKER_HOST = "unix:///nonexistent/otterdeploy-git-binds.sock";
  /* oxlint-enable node/no-process-env */
  return { dataDir: dir };
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

const N8N_POSTGRES = `services:
  postgres:
    image: postgres:16
    volumes:
      - db_storage:/var/lib/postgresql/data
      - ./init-data.sh:/docker-entrypoint-initdb.d/init-data.sh
      - ./library:/data
volumes:
  db_storage:
`;

async function seedGitStack() {
  const organizationId = await seedOrganization("binds");
  const { projectId, mainEnvironmentId } = await seedProject(organizationId);
  const stack = await createComposeRecord({
    projectId,
    environmentId: mainEnvironmentId,
    name: `n8n-${uniq()}`,
    source: "git",
    gitRepoUrl: "https://github.com/n8n-io/n8n-hosting",
    gitRef: "main",
    composeContent: N8N_POSTGRES,
    stackName: `n8n-${uniq()}`,
    services: [],
  });
  const checkout = await mkdtemp(join(tmpdir(), "git-binds-checkout-"));
  await writeFile(join(checkout, "init-data.sh"), "#!/bin/bash\ncreate user n8n\n");
  const dir = resourceDir({
    organizationId,
    projectId,
    environmentId: mainEnvironmentId,
    resourceId: stack.resource.id,
  });
  return { projectId, stack, checkout, dir };
}

describe("git stack bind mounts", () => {
  it("a script in the repo is mounted, from a copy that outlives the build", async () => {
    const { projectId, stack, checkout } = await seedGitStack();

    await deployCompose(
      { projectId, resourceId: stack.resource.id, sourceDir: checkout },
      "redeploy",
    );
    // The build ends: its checkout goes.
    await rm(checkout, { recursive: true, force: true });

    const [child] = await db
      .select({ resourceId: serviceResource.resourceId })
      .from(serviceResource)
      .where(eq(serviceResource.stackId, stack.resource.id));
    if (!child) throw new Error("the stack materialized no child");
    const mounts = await listServiceMounts(child.resourceId);
    const bind = mounts.find((m) => m.target === "/docker-entrypoint-initdb.d/init-data.sh");
    expect(bind?.type).toBe("bind");
    expect(bind?.source?.startsWith(dataDir)).toBe(true);
    expect(await readFile(bind?.source ?? "", "utf8")).toBe("#!/bin/bash\ncreate user n8n\n");
    // `./library` is nothing in the repo: compose would create an empty dir,
    // which is not ours to invent on the host.
    expect(mounts.some((m) => m.target === "/data")).toBe(false);
    expect(mounts.some((m) => m.type === "volume")).toBe(true);
  });

  it("a child created without its repo bind gets it on the next build deploy", async () => {
    const { projectId, stack, checkout } = await seedGitStack();
    // A stack whose child predates staged repo binds: rolled once with no staged
    // copy, so the child was created without the bind.
    await deployCompose({ projectId, resourceId: stack.resource.id }, "redeploy");
    const [child] = await db
      .select({ resourceId: serviceResource.resourceId })
      .from(serviceResource)
      .where(eq(serviceResource.stackId, stack.resource.id));
    if (!child) throw new Error("the stack materialized no child");
    const target = "/docker-entrypoint-initdb.d/init-data.sh";
    expect((await listServiceMounts(child.resourceId)).some((m) => m.target === target)).toBe(
      false,
    );

    // The upgrade's redeploy builds from the repo again: the existing child
    // must pick up the bind, not just the refreshed copy.
    await deployCompose(
      { projectId, resourceId: stack.resource.id, sourceDir: checkout },
      "redeploy",
    );
    await rm(checkout, { recursive: true, force: true });

    const mounts = await listServiceMounts(child.resourceId);
    const bind = mounts.find((m) => m.target === target);
    expect(bind?.type).toBe("bind");
    expect(await readFile(bind?.source ?? "", "utf8")).toBe("#!/bin/bash\ncreate user n8n\n");
    // Still only what the repo holds: `./library` is not invented.
    expect(mounts.some((m) => m.target === "/data")).toBe(false);
    // One row per target, not a duplicate per redeploy.
    expect(mounts.filter((m) => m.target === target)).toHaveLength(1);
  });

  it("a copy that cannot be written refuses the deploy, saying so", async () => {
    const { projectId, stack, checkout, dir } = await seedGitStack();
    // Where the copies go is already a FILE: no folder can be made there.
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "repo"), "in the way");

    const deployed = await deployCompose(
      { projectId, resourceId: stack.resource.id, sourceDir: checkout },
      "redeploy",
    );

    expect(deployed.isErr() && deployed.error.message).toMatch(
      /^Could not copy this stack's bind mounts out of the repo: /,
    );
    // Refused before the stack opened a deployment or materialized a child.
    const rows = await db
      .select()
      .from(deployment)
      .where(eq(deployment.resourceId, stack.resource.id));
    expect(rows).toEqual([]);
    await rm(checkout, { recursive: true, force: true });
  });
});
