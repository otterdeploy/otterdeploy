/**
 * Whole-map env saves under concurrency.
 *
 * A whole-map replace deleted the service's rows and then plain-INSERTed the
 * new map. Under READ COMMITTED a second replace, or a single-key set, that
 * inserted a key in between made that INSERT hit service_env_var_unique, and
 * the save answered 500. Replaces now queue on a row lock of their service and
 * upsert. The interleaving is not forced, so each case runs in rounds.
 */
import type { ResourceId } from "@otterdeploy/shared/id";

import { beforeAll, describe, expect, it } from "vite-plus/test";
import * as z from "zod";

import { seedOrganization, seedProject, seedService } from "../../../../__tests__/postgres-seed";
import { listServiceEnvVars, upsertServiceEnvVar } from "../env";
import { bulkReplaceServiceEnvVars } from "../env-bulk";

const pgCause = z.object({
  cause: z.object({ code: z.string(), constraint: z.string().optional() }),
});

/** What each rejected write failed with: the Postgres code and constraint. */
function rejections(outcomes: PromiseSettledResult<unknown>[]): string[] {
  return outcomes.flatMap((outcome) => {
    if (outcome.status !== "rejected") return [];
    const pgError = pgCause.safeParse(outcome.reason);
    return [
      pgError.success
        ? `${pgError.data.cause.code} ${pgError.data.cause.constraint ?? ""}`.trim()
        : String(outcome.reason).slice(0, 200),
    ];
  });
}

let serviceResourceId: ResourceId;

beforeAll(async () => {
  const organizationId = await seedOrganization("env-bulk");
  const project = await seedProject(organizationId);
  ({ resourceId: serviceResourceId } = await seedService({
    projectId: project.projectId,
    environmentId: project.mainEnvironmentId,
    name: "web",
  }));
});

describe("concurrent whole-map env saves", () => {
  it("a replace and a single-key set on the same key both succeed", async () => {
    const failures: string[] = [];
    for (let round = 0; round < 200 && failures.length === 0; round += 1) {
      await bulkReplaceServiceEnvVars(serviceResourceId, [], "ui");
      const outcomes = await Promise.allSettled([
        bulkReplaceServiceEnvVars(serviceResourceId, [{ key: "R", value: `bulk${round}` }], "ui"),
        upsertServiceEnvVar({ serviceResourceId, key: "R", value: `set${round}`, source: "cli" }),
      ]);
      failures.push(...rejections(outcomes));
    }
    expect(failures).toEqual([]);
  });

  it("two replaces both succeed, and the map is one of the two", async () => {
    const failures: string[] = [];
    const mixed: string[] = [];
    for (let round = 0; round < 100 && failures.length === 0; round += 1) {
      await bulkReplaceServiceEnvVars(serviceResourceId, [], "ui");
      const outcomes = await Promise.allSettled([
        bulkReplaceServiceEnvVars(
          serviceResourceId,
          [
            { key: "A", value: `a${round}` },
            { key: "B", value: `a${round}` },
          ],
          "ui",
        ),
        bulkReplaceServiceEnvVars(
          serviceResourceId,
          [
            { key: "B", value: `b${round}` },
            { key: "C", value: `b${round}` },
          ],
          "ui",
        ),
      ]);
      failures.push(...rejections(outcomes));
      const rows = await listServiceEnvVars(serviceResourceId);
      const map = rows
        .map((row) => `${row.key}=${row.value}`)
        .toSorted()
        .join(",");
      if (![`A=a${round},B=a${round}`, `B=b${round},C=b${round}`].includes(map)) mixed.push(map);
    }
    expect({ failures, mixed }).toEqual({ failures: [], mixed: [] });
  });
});
