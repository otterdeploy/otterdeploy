/**
 * After a platform update, the control plane leaves recovery mode by telling
 * its own node `platform.recovered` once it is healthy and its schema is
 * current, never while an update is still running, and only once.
 */
import type { Command } from "@otterdeploy/otterd-proto";

import { db } from "@otterdeploy/db";
import { otterdNode } from "@otterdeploy/db/schema/otterd";
import { publicKeyFromSeed } from "@otterdeploy/otterd-proto";
import { Result } from "better-result";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import type { Hub } from "../hub/hub";

import { recoveryLeave } from "../recovery-leave";

const NOW = 1_980_000_000_000;
const run = randomUUID().slice(0, 8);
const nodeId = `rec-${run}`;
const digest = "c".repeat(64);

describe("leaving recovery mode", () => {
  beforeAll(async () => {
    await db.insert(otterdNode).values({
      nodeId,
      ordinal: 60_000_000 + Math.floor(Math.random() * 1e6),
      nodeEpoch: 1,
      keyEpoch: 1,
      identityKey: publicKeyFromSeed(new Uint8Array(32).fill(51)),
      identityKeyId: "6".repeat(32),
      roles: ["worker"],
      labels: { "otterdeploy.primary": "true" },
      arch: "x86_64",
      host: {},
      facts: {},
      allocatableNanoCpus: 2e9,
      allocatableMemoryBytes: 4 * 1024 ** 3,
      enrolledAt: NOW + 5_000_000,
      updatedAt: NOW,
    });
  });

  it("waits for a settled update, then tells its own node once", async () => {
    const sent: { nodeId: string; command: Command }[] = [];
    let phase: "new-cp-started" | "committed" = "new-cp-started";
    let clock = NOW;
    const hub: Pick<Hub, "platformOf" | "request"> = {
      platformOf: () => ({
        phase: "running",
        manifestDigest: digest,
        update: {
          updateId: "upd_1",
          phase,
          irreversible: false,
          fromManifestDigest: "d".repeat(64),
          toManifestDigest: digest,
        },
      }),
      request: async (to, command) => {
        sent.push({ nodeId: to, command });
        return Result.ok({
          kind: "outcome",
          duplicate: false,
          outcome: { status: "completed", result: { kind: "done" } },
        });
      },
    };
    const leave = recoveryLeave({ hub, now: () => clock });
    expect(await leave()).toBe(false);
    expect(sent).toEqual([]);
    phase = "committed";
    clock += 60_000;
    expect(await leave()).toBe(true);
    expect(sent).toEqual([
      { nodeId, command: { verb: "platform.recovered", manifestDigest: digest } },
    ]);
    clock += 60_000;
    expect(await leave()).toBe(true);
    expect(sent).toHaveLength(1);
  });
});
