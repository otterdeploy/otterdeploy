/**
 * Staging a change on a project with no saved manifest names the project.
 *
 * The first staged change seeds an empty manifest, whose `project` was `""`.
 * The server requires a slug there (and refuses one naming another project),
 * so every staging surface except the two wizards that filled it themselves
 * failed its first change with a validation toast.
 */
import { idSchema } from "@otterdeploy/shared/id";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const calls = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  projectGet: vi.fn(),
  slugById: vi.fn(),
}));

vi.mock("@/shared/server/orpc", () => ({
  orpc: {
    project: {
      get: { call: calls.projectGet },
      manifest: { get: { call: calls.get }, save: { call: calls.save } },
    },
  },
  queryClient: {},
}));
vi.mock("@/features/projects/data/project", () => ({ projectSlugById: calls.slugById }));
vi.mock("@/features/projects/data/dependencies", () => ({ DEPENDENCIES_COLLECTION_KEY: [] }));
vi.mock("@/features/resources/data/resource", () => ({ RESOURCE_COLLECTION_KEY: [] }));
vi.mock("@/features/resources/data/service-tasks", () => ({ SERVICE_TASKS_COLLECTION_KEY: [] }));

const { stageManifestChange } = await import("./use-manifest-stage");

const projectId = idSchema.project.parse("prj_shop");
const addWeb = <T extends { services: Record<string, unknown> }>(manifest: T): T => ({
  ...manifest,
  services: { ...manifest.services, web: { source: "image", image: "nginx" } },
});

function savedProject(): unknown {
  const [input] = calls.save.mock.calls.at(-1) ?? [];
  return input?.manifest?.project;
}

describe("stageManifestChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.save.mockResolvedValue({ version: 1 });
    calls.get.mockResolvedValue({ manifest: null, version: 0 });
  });

  it("names the project when it seeds the first manifest", async () => {
    calls.slugById.mockReturnValue("shop");

    await stageManifestChange(projectId, addWeb);

    expect(savedProject()).toBe("shop");
  });

  it("asks the server for the slug when the project list has not loaded it", async () => {
    calls.slugById.mockReturnValue(undefined);
    calls.projectGet.mockResolvedValue({ slug: "shop" });

    await stageManifestChange(projectId, addWeb);

    expect(calls.projectGet).toHaveBeenCalledWith({ id: projectId });
    expect(savedProject()).toBe("shop");
  });

  it("keeps the name a saved manifest already carries", async () => {
    calls.slugById.mockReturnValue("shop");
    calls.get.mockResolvedValue({
      manifest: { version: 1, project: "shop", services: {}, databases: {}, composes: {} },
      version: 4,
    });

    await stageManifestChange(projectId, addWeb);

    expect(savedProject()).toBe("shop");
    expect(calls.save).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4 }));
  });
});
