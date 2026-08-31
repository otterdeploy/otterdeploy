/**
 * od-uhot: a stack child's env has to reach the manifest.
 *
 * `syncManifestServiceEnv` looked in `manifest.services[name]` only. A compose
 * child is not there — it lives at `composes[stack].services[composeKey]` —
 * so the lookup missed and returned, and every per-service override on a stack
 * existed only as DB rows: invisible to `otd export`, to DR restore, and to
 * the diff.
 *
 * The key is the COMPOSE key, not the resource name: `pickResourceName`
 * renames a child (`db` → `autumn-db`) while the compose key is what the file
 * and the manifest both speak.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

const loadManifest = vi.fn();
const saveManifest = vi.fn();

vi.mock("../manifest", () => ({ loadManifest, saveManifest }));

const { syncManifestServiceEnv } = await import("../manifest-env-sync");

const scope = {
  projectId: idSchema.project.parse("prj_uhot00000000000000000"),
  organizationId: idSchema.organization.parse("org_uhot00000000000000000"),
};

function manifestWith(services: Record<string, unknown> | undefined) {
  return {
    isErr: () => false,
    value: {
      version: 3,
      manifest: {
        project: "shared",
        services: {},
        databases: {},
        composes: {
          postiz: { source: "inline", content: "x", ...(services ? { services } : {}) },
        },
      },
    },
  };
}

beforeEach(() => {
  loadManifest.mockReset();
  saveManifest.mockReset();
});

describe("syncManifestServiceEnv, stack child", () => {
  test("writes a child's env under composes[stack].services[composeKey]", async () => {
    loadManifest.mockResolvedValue(manifestWith(undefined));
    await syncManifestServiceEnv(
      scope,
      { kind: "stackChild", stackName: "postiz", composeService: "db" },
      { POSTGRES_PASSWORD: "hunter2" },
    );
    expect(saveManifest).toHaveBeenCalledOnce();
    const [, payload] = saveManifest.mock.calls[0] ?? [];
    expect(payload.manifest.composes.postiz.services.db.env).toEqual({
      POSTGRES_PASSWORD: "hunter2",
    });
    expect(payload.expectedVersion).toBe(3);
  });

  test("preserves a declared ${secret} on a surviving key", async () => {
    // The row holds the resolved value; overwriting the declaration with it
    // would destroy the declaration and leak the value into the manifest.
    loadManifest.mockResolvedValue(
      manifestWith({ db: { env: { PASSWORD: "${secret}", PLAIN: "old" } } }),
    );
    await syncManifestServiceEnv(
      scope,
      { kind: "stackChild", stackName: "postiz", composeService: "db" },
      { PASSWORD: "resolved-cleartext", PLAIN: "new" },
    );
    const [, payload] = saveManifest.mock.calls[0] ?? [];
    expect(payload.manifest.composes.postiz.services.db.env).toEqual({
      PASSWORD: "${secret}",
      PLAIN: "new",
    });
  });

  test("does not save when nothing changed", async () => {
    loadManifest.mockResolvedValue(manifestWith({ db: { env: { A: "1" } } }));
    await syncManifestServiceEnv(
      scope,
      { kind: "stackChild", stackName: "postiz", composeService: "db" },
      { A: "1" },
    );
    expect(saveManifest).not.toHaveBeenCalled();
  });

  test("leaves other children untouched", async () => {
    loadManifest.mockResolvedValue(manifestWith({ redis: { env: { R: "1" } } }));
    await syncManifestServiceEnv(
      scope,
      { kind: "stackChild", stackName: "postiz", composeService: "db" },
      { D: "2" },
    );
    const [, payload] = saveManifest.mock.calls[0] ?? [];
    expect(payload.manifest.composes.postiz.services.redis.env).toEqual({ R: "1" });
    expect(payload.manifest.composes.postiz.services.db.env).toEqual({ D: "2" });
  });

  test("does nothing for a stack the manifest does not mention", async () => {
    loadManifest.mockResolvedValue(manifestWith(undefined));
    await syncManifestServiceEnv(
      scope,
      { kind: "stackChild", stackName: "not-in-manifest", composeService: "db" },
      { A: "1" },
    );
    expect(saveManifest).not.toHaveBeenCalled();
  });
});
