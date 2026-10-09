/**
 * a `${service:<name>.host}` ref to a service created in the SAME
 * apply used to be skipped ("service not found"): the ref table was read before
 * the creates ran, so fider, documenso, rallly and plausible all needed a
 * second Apply. The staged service resolves to the hostname it is about to
 * get, which is derived from its name alone.
 */
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@otterdeploy/db", () => ({ db: {} }));

const { resolveEnv, withStagedServices } = await import("../manifest-apply-refs");
const { deriveServiceNames } = await import("../../service/inputs");

const empty = { databases: new Map(), services: new Map<string, { host: string }>() };

describe("withStagedServices", () => {
  it("resolves a ref to a service staged in this apply, in this apply", () => {
    const before = resolveEnv("web", { API_HOST: "${service:Fider API.host}" }, empty, {});
    expect(before.values).toEqual([]);
    expect(before.skipped).toHaveLength(1);

    const refs = withStagedServices(empty, ["Fider API"]);
    const after = resolveEnv(
      "web",
      { API_HOST: "http://${service:Fider API.host}:3000" },
      refs,
      {},
    );
    expect(after.skipped).toEqual([]);
    expect(after.values).toEqual([
      {
        key: "API_HOST",
        // The alias createService will register for it.
        value: `http://${deriveServiceNames("proj", "Fider API").internalHostname}:3000`,
      },
    ]);
  });

  it("keeps an existing service's stored hostname", () => {
    const existing = {
      databases: new Map(),
      services: new Map([["api", { host: "api-legacy-alias" }]]),
    };
    const refs = withStagedServices(existing, ["api"]);
    expect(refs.services.get("api")?.host).toBe("api-legacy-alias");
  });

  it("still reports a ref to a service nobody declared", () => {
    const refs = withStagedServices(empty, ["api"]);
    const out = resolveEnv("web", { X: "${service:ghost.host}" }, refs, {});
    expect(out.skipped[0]?.reason).toContain("service not found");
  });
});
