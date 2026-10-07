/**
 * The provision job's status moves are guarded transitions.
 *
 * A duplicated or redelivered `server.provision` job finds the row no longer
 * `pending` and does nothing, so it can never take down a node an earlier run
 * joined. A job whose worker died leaves its row in `provisioning`/`joining`
 * with nothing that would ever move it; the stalled-provision reaper fails it,
 * which is what lets the operator retry it, and the dead job's late steps are
 * refused.
 *
 * Real Postgres, real job body and handlers. The provision log stream and the
 * queue are stood in for: neither is what is under test.
 */
import type { OrganizationId, ServerId, SshKeyId } from "@otterdeploy/shared/id";

import { db } from "@otterdeploy/db";
import { server } from "@otterdeploy/db/schema/server";
import { Temporal } from "@otterdeploy/shared/temporal";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { seedOrganization, uniq } from "../../../__tests__/postgres-seed";
import { generateSshKey } from "../../sshKeys/handlers";
import { retryProvision } from "../handlers";
import { runProvisionJob } from "../provision-runner";
import {
  claimServerProvision,
  markServerJoining,
  PROVISION_STALL_MS,
  reapStalledProvisions,
} from "../provision-status";
import { insertProvisioningServer } from "../queries";

const { lines, triggered } = vi.hoisted(() => ({
  lines: new Array<string>(),
  triggered: new Array<string>(),
}));

vi.mock("../provision-stream", () => ({
  emitProvisionLine: (_serverId: string, line: string) => {
    lines.push(line);
  },
  endProvisionStream: () => undefined,
}));

vi.mock("@otterdeploy/jobs", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  triggerProvisionServer: async (payload: { serverId: string }) => {
    triggered.push(payload.serverId);
  },
}));

let organizationId: OrganizationId;
let sshKeyId: SshKeyId;

beforeAll(async () => {
  organizationId = await seedOrganization("provision");
  const key = await generateSshKey({ organizationId, name: `key-${uniq()}`, type: "ed25519" });
  if (key.isErr()) throw new Error(`seed ssh key: ${key.error.message}`);
  sshKeyId = key.value.id;
});

beforeEach(() => {
  lines.length = 0;
  triggered.length = 0;
});

async function insertServer(): Promise<ServerId> {
  const row = await insertProvisioningServer({
    organizationId,
    name: `node-${uniq()}`,
    host: `node-${uniq()}.internal`,
    role: "worker",
    sshKeyId,
    sshUser: "root",
    sshPort: 22,
  });
  if (!row) throw new Error("server insert returned no row");
  return row.id;
}

/** Put a row where a run left it. `quietForMs` backdates its last write. A
 *  Date only at the drizzle timestamp seam. */
async function setProvision(
  id: ServerId,
  provisionStatus: "provisioning" | "joining" | "ready",
  quietForMs = 0,
): Promise<void> {
  await db
    .update(server)
    .set({
      provisionStatus,
      status: provisionStatus === "ready" ? "ready" : "down",
      updatedAt: new Date(
        Temporal.Now.instant().subtract({ milliseconds: quietForMs }).epochMilliseconds,
      ),
    })
    .where(eq(server.id, id));
}

async function readServer(id: ServerId) {
  const [row] = await db
    .select({
      provisionStatus: server.provisionStatus,
      status: server.status,
      provisionError: server.provisionError,
    })
    .from(server)
    .where(eq(server.id, id));
  if (!row) throw new Error(`server ${id} vanished`);
  return row;
}

describe("a redelivered provision job", () => {
  it("does nothing to a node that already joined", async () => {
    const id = await insertServer();
    await setProvision(id, "ready");

    await runProvisionJob({
      serverId: id,
      organizationId,
      host: "10.0.0.1",
      sshUser: "root",
      sshPort: 22,
      role: "worker",
      sshKeyId,
      buildServer: false,
      meshProvider: "none",
      firewallOnly: false,
    });

    expect(await readServer(id)).toEqual({
      provisionStatus: "ready",
      status: "ready",
      provisionError: null,
    });
    expect(lines.some((line) => line.includes("nothing to do"))).toBe(true);
    expect(lines.some((line) => line.includes("provisioning failed"))).toBe(false);
  });

  it("cannot claim a row another run is already provisioning", async () => {
    const id = await insertServer();
    expect(await claimServerProvision(id, organizationId)).toBeDefined();
    expect(await claimServerProvision(id, organizationId)).toBeUndefined();
    expect((await readServer(id)).provisionStatus).toBe("provisioning");
  });
});

describe("a provision whose worker died", () => {
  it("is reaped once it stops making progress, then retryable", async () => {
    const id = await insertServer();
    await setProvision(id, "joining", PROVISION_STALL_MS + 60_000);

    const reaped = await reapStalledProvisions();
    expect(reaped.map((row) => row.id)).toContain(id);
    const after = await readServer(id);
    expect(after.provisionStatus).toBe("failed");
    expect(after.provisionError).toContain("Retry");

    const retried = await retryProvision({ id, organizationId });
    expect(retried.isOk()).toBe(true);
    expect((await readServer(id)).provisionStatus).toBe("pending");
    expect(triggered).toEqual([id]);
  });

  it("leaves a provision that is still making progress alone", async () => {
    const id = await insertServer();
    await setProvision(id, "provisioning");
    const reaped = await reapStalledProvisions();
    expect(reaped.map((row) => row.id)).not.toContain(id);
    expect((await readServer(id)).provisionStatus).toBe("provisioning");
  });

  it("refuses the late steps of a job that was reaped", async () => {
    const id = await insertServer();
    await setProvision(id, "provisioning", PROVISION_STALL_MS + 60_000);
    await reapStalledProvisions();

    const joining = await markServerJoining(id, organizationId, {
      hostname: "node-late",
      meshAddress: null,
    });
    expect(joining).toBeUndefined();
    expect((await readServer(id)).provisionStatus).toBe("failed");
  });
});
