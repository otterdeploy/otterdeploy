import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * A just-created destination carries the server's id the moment the create
 * returns.
 *
 * The collection used to insert a row under a temp id and then refetch,
 * hoping the list landed before anyone clicked. Clicking Test on the new row
 * right after the relist sent the temp id: NOT_FOUND until a reload. The fix writes the server's row in place of the optimistic one.
 */
import type { Destination } from "./destinations";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const SERVER_ID = createId(ID_PREFIX.backupDestination);
const TEMP_ID = createId(ID_PREFIX.backupDestination);

type Row = Destination;

function row(id: Destination["id"], name: string): Row {
  const at = new Date(0);
  return {
    id,
    organizationId: "org_1",
    name,
    type: "s3",
    config: { bucket: "b" },
    status: "active",
    managed: false,
    usedForBackups: true,
    usedBytes: 0,
    createdAt: at,
    updatedAt: at,
  };
}

let serverRows: Row[] = [];
const create = vi.fn(async (input: { name: string }) => {
  const created = row(SERVER_ID, input.name);
  serverRows = [...serverRows, created];
  return created;
});
const list = vi.fn(async () => serverRows);
const test = vi.fn(async ({ id }: { id: Destination["id"] }) => {
  if (!serverRows.some((r) => r.id === id)) throw new Error("NOT_FOUND");
  return { ok: true, message: "reachable" };
});

vi.mock("@/shared/server/orpc", () => ({
  queryClient,
  orpc: {
    backups: {
      destinations: {
        list: {
          queryKey: () => ["backups", "destinations", "list"],
          queryOptions: () => ({ queryKey: ["backups", "destinations", "list"] }),
          call: () => list(),
        },
        create: { call: (input: { name: string }) => create(input) },
        update: { call: vi.fn() },
        delete: { call: vi.fn() },
        test: { call: (input: { id: Destination["id"] }) => test(input) },
      },
    },
  },
}));

vi.mock("@/shared/db/sqlite-persistence", () => ({ persistence: null }));

const { destinationsCollection, testDestination } = await import("./destinations");

beforeEach(() => {
  serverRows = [];
  list.mockClear();
});

describe("destinationsCollection insert", () => {
  it("holds the server's row, not the temp one, once the create returns", async () => {
    await destinationsCollection.preload();
    const tx = destinationsCollection.insert(row(TEMP_ID, "offsite-s3"));
    await tx.isPersisted.promise;

    const ids = [...destinationsCollection.values()].map((d) => d.id);
    expect(ids).toEqual([SERVER_ID]);
    // Applied from the create's own answer: no relist round trip, so there is
    // no window in which the list has landed and the temp row is still the
    // one on screen.
    expect(list).toHaveBeenCalledTimes(1);
    // What the operator does next: Test the row they see. It must name a
    // destination the server knows.
    const shown = [...destinationsCollection.values()][0];
    expect(shown).toBeDefined();
    await expect(testDestination(shown?.id ?? TEMP_ID)).resolves.toMatchObject({ ok: true });
  });
});
