/**
 * od-w2r: an explicitly-marked secret must survive Apply.
 *
 * Apply REPLACES a service's env rows, and the manifest had nowhere to record
 * which keys were sensitive — so every apply re-inserted them unflagged and
 * the UI fell back to key-name heuristics. A key called `TOKEN` looked secret
 * again by luck; one called `MY_THING` did not, and quietly rendered in the
 * clear.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const loadManifest = vi.fn();
const saveManifest = vi.fn();

vi.mock("../manifest", () => ({ loadManifest, saveManifest }));

const { syncManifestServiceEnv } = await import("../manifest-env-sync");

const scope = {
  projectId: idSchema.project.parse("prj_w2r000000000000000000"),
  organizationId: idSchema.organization.parse("org_w2r0000000000000000000"),
};

function manifestWith(entry: Record<string, unknown>) {
  return {
    isErr: () => false,
    value: {
      version: 1,
      manifest: { project: "shared", services: { api: entry }, databases: {}, composes: {} },
    },
  };
}

const target = { kind: "service", name: "api" } as const;

beforeEach(() => {
  loadManifest.mockReset();
  saveManifest.mockReset();
});

describe("secret flags in the manifest", () => {
  test("records which keys the operator marked sensitive", async () => {
    loadManifest.mockResolvedValue(manifestWith({ env: { A: "1", MY_THING: "2" } }));
    await syncManifestServiceEnv(scope, target, { A: "1", MY_THING: "2" }, ["MY_THING"]);
    const [, payload] = saveManifest.mock.calls[0] ?? [];
    expect(payload.manifest.services.api.secrets).toEqual(["MY_THING"]);
  });

  test("a flag change alone is enough to save", async () => {
    // Values identical; only the marking moved. Without this the manifest kept
    // the stale list and the next apply un-flagged the key again.
    loadManifest.mockResolvedValue(manifestWith({ env: { A: "1" }, secrets: [] }));
    await syncManifestServiceEnv(scope, target, { A: "1" }, ["A"]);
    expect(saveManifest).toHaveBeenCalledOnce();
  });

  test("does not save when the flags only differ in order", async () => {
    loadManifest.mockResolvedValue(manifestWith({ env: { A: "1", B: "2" }, secrets: ["B", "A"] }));
    await syncManifestServiceEnv(scope, target, { A: "1", B: "2" }, ["A", "B"]);
    expect(saveManifest).not.toHaveBeenCalled();
  });

  test("omits the field entirely when nothing is flagged", async () => {
    loadManifest.mockResolvedValue(manifestWith({ env: { A: "1" } }));
    await syncManifestServiceEnv(scope, target, { A: "2" }, []);
    const [, payload] = saveManifest.mock.calls[0] ?? [];
    // A manifest that never used the field must not grow an empty array.
    expect("secrets" in payload.manifest.services.api).toBe(false);
  });
});
