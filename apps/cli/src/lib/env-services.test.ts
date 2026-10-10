import { describe, expect, it, vi } from "vite-plus/test";

// The real abort ends the process; here it ends the lookup where it would.
vi.mock("./ui", () => ({
  abort: (message: string) => {
    throw new Error(message);
  },
}));

import { environmentServices, type EnvironmentServiceLister } from "./env-services";

/** Two environments that each hold a service named `web`. */
function fakeProject(): EnvironmentServiceLister & { asked: Array<string | undefined> } {
  const asked: Array<string | undefined> = [];
  return {
    asked,
    env: {
      list: async () => [
        { id: "env_main", slug: "production" },
        { id: "env_stage", slug: "staging" },
      ],
    },
    project: {
      resource: {
        // Like the server: no environmentId means the main environment.
        list: async ({ environmentId }) => {
          asked.push(environmentId);
          return environmentId === "env_stage"
            ? [{ type: "service", name: "web", resourceId: "res_stage_web" }]
            : [
                { type: "service", name: "web", resourceId: "res_main_web" },
                { type: "postgres", name: "db", resourceId: "res_main_db" },
              ];
        },
      },
    },
  };
}

describe("environmentServices", () => {
  it("deploy --env staging resolves staging's own services, not production's", async () => {
    const client = fakeProject();
    const services = await environmentServices(client, "prj_1", "staging");
    expect(services.get("web")).toBe("res_stage_web");
    expect(client.asked).toEqual(["env_stage"]);
  });

  it("without --env it is the main environment, and only services", async () => {
    const client = fakeProject();
    const services = await environmentServices(client, "prj_1", undefined);
    expect([...services]).toEqual([["web", "res_main_web"]]);
    expect(client.asked).toEqual([undefined]);
  });

  it("an environment the project does not have is refused, and no list is read", async () => {
    const client = fakeProject();
    await expect(environmentServices(client, "prj_1", "qa")).rejects.toThrow(/No environment `qa`/);
    expect(client.asked).toEqual([]);
  });
});
