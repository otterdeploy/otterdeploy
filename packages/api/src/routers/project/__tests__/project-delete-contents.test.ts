import type { RequestLogger } from "evlog";

import { idSchema } from "@otterdeploy/shared/id";
import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

interface ResourceRow {
  id: string;
  name: string;
  type: string;
  previewId: string | null;
  hostResourceId: string | null;
}
const state = vi.hoisted(() => {
  const rows: ResourceRow[] = [];
  return {
    rows,
    delete:
      vi.fn<
        (
          input: { resourceId: string },
          log: RequestLogger,
        ) => Promise<Result<{ ok: boolean }, Error>>
      >(),
  };
});
vi.mock("@otterdeploy/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            $withCache: async () => [...state.rows],
          }),
        }),
      }),
    }),
  },
}));
vi.mock("../resource-delete", () => ({ deleteProjectResource: state.delete }));
import { deleteProjectContents } from "../project-delete-contents";

const scope = {
  projectId: idSchema.project.parse("prj_delete"),
  organizationId: idSchema.organization.parse("org_delete"),
};
const log: RequestLogger = {
  set: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  emit: () => null,
  getContext: () => ({}),
};
function row(
  name: string,
  type = "service",
  previewId: string | null = null,
  hostResourceId: string | null = null,
) {
  return { id: `res_${name}`, name, type, previewId, hostResourceId };
}
beforeEach(() => {
  state.rows = [];
  state.delete.mockReset();
  state.delete.mockImplementation(async ({ resourceId }) => {
    state.rows = state.rows.filter((r) => r.id !== resourceId);
    return Result.ok({ ok: true });
  });
});
describe("confirmed project contents deletion", () => {
  it("deletes a stack once and does not retry its children after cascade", async () => {
    state.rows = [row("child"), row("stack", "compose")];
    state.delete.mockImplementation(async () => {
      state.rows = [];
      return Result.ok({ ok: true });
    });
    expect((await deleteProjectContents(scope, log)).isOk()).toBe(true);
    expect(state.delete).toHaveBeenCalledExactlyOnceWith(
      { ...scope, resourceId: "res_stack" },
      log,
    );
  });
  it("deletes preview branches and hosted databases before their source/host", async () => {
    state.rows = [
      row("host", "database"),
      row("tenant", "database", null, "res_host"),
      row("branch", "database", "prv_one"),
    ];
    expect((await deleteProjectContents(scope, log)).isOk()).toBe(true);
    expect(state.delete.mock.calls.map(([input]) => input.resourceId)).toEqual([
      "res_branch",
      "res_tenant",
      "res_host",
    ]);
  });
  it("stops and names the resource when teardown is refused", async () => {
    state.rows = [row("protected"), row("later")];
    state.delete.mockResolvedValue(
      Result.err(new Error("database has tenants in another project")),
    );
    const result = await deleteProjectContents(scope, log);
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error.message).toContain("database has tenants in another project");
    expect(state.delete).toHaveBeenCalledTimes(1);
    expect(state.rows).toHaveLength(2);
  });
  it("does not report success if a teardown returns without removing its row", async () => {
    state.rows = [row("stuck")];
    state.delete.mockResolvedValue(Result.ok({ ok: true }));
    expect((await deleteProjectContents(scope, log)).isErr()).toBe(true);
    expect(state.delete).toHaveBeenCalledTimes(1);
  });
  it("does not delete resources added after confirmation", async () => {
    state.rows = [row("original")];
    state.delete.mockImplementation(async () => {
      state.rows = [row("new")];
      return Result.ok({ ok: true });
    });
    expect((await deleteProjectContents(scope, log)).isErr()).toBe(true);
    expect(state.delete).toHaveBeenCalledTimes(1);
  });
});
