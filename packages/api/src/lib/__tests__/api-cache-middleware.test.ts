import type { OrganizationId } from "@otterdeploy/shared/id";

import { createProcedureClient, os as orpc } from "@orpc/server";
import { idSchema } from "@otterdeploy/shared/id";
import { createRequestLogger } from "evlog";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import * as z from "zod";

vi.mock("../api-cache", () => ({
  readApiCache: vi.fn(),
  writeApiCache: vi.fn(),
  invalidateApiCache: vi.fn(),
}));

import type { Context } from "../../context";

import * as store from "../api-cache";
import { cacheApiResponse, invalidateApiResponses } from "../api-cache-middleware";

const context: Context & { activeOrganizationId: OrganizationId } = {
  actor: null,
  session: null,
  apiKey: null,
  activeOrganizationId: idSchema.organization.parse("org_acme"),
  headers: new Headers(),
  log: createRequestLogger({ method: "TEST", path: "/api-cache" }),
  broadcast: () => {},
};

describe("cacheApiResponse", () => {
  beforeEach(() => vi.clearAllMocks());

  test("returns a cache hit without calling the handler", async () => {
    vi.mocked(store.readApiCache).mockResolvedValue({ value: "cached" });
    const handler = vi.fn(async () => ({ value: "fresh" }));
    const middleware = cacheApiResponse<{ projectId: string }, { value: string }>({
      endpoint: "project.example.list",
      ttlSeconds: 10,
      dependencyTables: ["example"],
      outputSchema: z.object({ value: z.string() }),
      scope: async ({ context: ctx, input }) => [ctx.activeOrganizationId, input.projectId],
    });
    const procedure = orpc
      .$context<typeof context>()
      .input(z.object({ projectId: z.string() }))
      .output(z.object({ value: z.string() }))
      .use(middleware)
      .handler(handler);
    const client = createProcedureClient(procedure, { context });

    await expect(client({ projectId: "prj_console" })).resolves.toEqual({ value: "cached" });
    expect(handler).not.toHaveBeenCalled();
    expect(store.writeApiCache).not.toHaveBeenCalled();
  });

  test("calls next and stores the successful output on a miss", async () => {
    vi.mocked(store.readApiCache).mockResolvedValue(undefined);
    const middleware = cacheApiResponse<{ projectId: string }, { value: string }>({
      endpoint: "project.example.list",
      ttlSeconds: 10,
      dependencyTables: ["example"],
      outputSchema: z.object({ value: z.string() }),
      scope: async ({ context: ctx, input }) => [ctx.activeOrganizationId, input.projectId],
    });
    const procedure = orpc
      .$context<typeof context>()
      .input(z.object({ projectId: z.string() }))
      .output(z.object({ value: z.string() }))
      .use(middleware)
      .handler(async () => ({ value: "fresh" }));
    const client = createProcedureClient(procedure, { context });

    await expect(client({ projectId: "prj_console" })).resolves.toEqual({ value: "fresh" });
    expect(store.writeApiCache).toHaveBeenCalledWith(
      expect.objectContaining({
        canonical: '["otterdeploy-api-cache","project.example.list",1,"org_acme","prj_console"]',
      }),
      { value: "fresh" },
      { ttlSeconds: 10, dependencyTables: ["example"] },
    );
  });
});

describe("invalidateApiResponses", () => {
  beforeEach(() => vi.clearAllMocks());

  test("invalidates only after the mutation succeeds", async () => {
    const middleware = invalidateApiResponses<{ projectId: string }>({
      targets: async ({ context: ctx, input }) => [
        {
          endpoint: "project.example.list",
          scope: [ctx.activeOrganizationId, input.projectId],
        },
      ],
    });
    const procedure = orpc
      .$context<typeof context>()
      .input(z.object({ projectId: z.string() }))
      .output(z.object({ ok: z.boolean() }))
      .use(middleware)
      .handler(async () => ({ ok: true }));
    const client = createProcedureClient(procedure, { context });

    await expect(client({ projectId: "prj_console" })).resolves.toEqual({ ok: true });
    expect(store.invalidateApiCache).toHaveBeenCalledTimes(1);
  });

  test("does not invalidate when the mutation fails", async () => {
    const middleware = invalidateApiResponses<{ projectId: string }>({
      targets: async ({ context: ctx, input }) => [
        {
          endpoint: "project.example.list",
          scope: [ctx.activeOrganizationId, input.projectId],
        },
      ],
    });
    const procedure = orpc
      .$context<typeof context>()
      .input(z.object({ projectId: z.string() }))
      .output(z.object({ ok: z.boolean() }))
      .use(middleware)
      .handler(async () => {
        throw new Error("write failed");
      });
    const client = createProcedureClient(procedure, { context });

    await expect(client({ projectId: "prj_console" })).rejects.toThrow("write failed");
    expect(store.invalidateApiCache).not.toHaveBeenCalled();
  });
});
