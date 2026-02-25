import { describe, it, expect, vi, beforeEach } from "vitest";
import { setDockerClient, resetDockerClient } from "../client";
import {
  pullImage,
  tagImage,
  removeImage,
  pruneImages,
  listImages,
} from "../image";

function createMockDocker(overrides: Record<string, unknown> = {}) {
  return {
    pull: vi.fn().mockResolvedValue("stream"),
    modem: {
      followProgress: vi.fn((_stream: any, cb: (err: Error | null) => void) => {
        cb(null);
      }),
    },
    getImage: vi.fn().mockReturnValue({
      tag: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    }),
    pruneImages: vi.fn().mockResolvedValue({ SpaceReclaimed: 1024 }),
    listImages: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as import("dockerode");
}

describe("pullImage", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("pulls an image with tag", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await pullImage("nginx", "1.25");

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe("nginx:1.25");
    expect(mock.pull).toHaveBeenCalledWith("nginx:1.25");
  });

  it("pulls an image without tag (uses full name as-is)", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await pullImage("nginx:latest");

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe("nginx:latest");
  });

  it("returns error when pull fails", async () => {
    const mock = createMockDocker({
      pull: vi.fn().mockRejectedValue(new Error("pull failed")),
    });
    setDockerClient(mock);

    const result = await pullImage("nonexistent/image");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toBe("pull failed");
    }
  });
});

describe("tagImage", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("tags an image with repo:tag", async () => {
    const mockTag = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      getImage: vi.fn().mockReturnValue({ tag: mockTag }),
    });
    setDockerClient(mock);

    const result = await tagImage("nginx:latest", "myregistry/nginx:v1");

    expect(result.isOk()).toBe(true);
    expect(mockTag).toHaveBeenCalledWith({ repo: "myregistry/nginx", tag: "v1" });
  });
});

describe("removeImage", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("removes an image", async () => {
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mock = createMockDocker({
      getImage: vi.fn().mockReturnValue({ remove: mockRemove }),
    });
    setDockerClient(mock);

    const result = await removeImage("nginx", "1.25");

    expect(result.isOk()).toBe(true);
    expect(mock.getImage).toHaveBeenCalledWith("nginx:1.25");
  });
});

describe("pruneImages", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("prunes dangling images", async () => {
    const mock = createMockDocker();
    setDockerClient(mock);

    const result = await pruneImages(true);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().spaceReclaimed).toBe(1024);
    expect(mock.pruneImages).toHaveBeenCalledWith({
      filters: { dangling: ["true"] },
    });
  });
});

describe("listImages", () => {
  beforeEach(() => {
    resetDockerClient();
  });

  it("lists images and maps to ImageInfo", async () => {
    const mock = createMockDocker({
      listImages: vi.fn().mockResolvedValue([
        {
          Id: "sha256:abc",
          RepoTags: ["nginx:latest"],
          Size: 150 * 1024 * 1024,
          Created: 1700000000,
        },
      ]),
    });
    setDockerClient(mock);

    const result = await listImages();

    expect(result.isOk()).toBe(true);
    const images = result.unwrap();
    expect(images).toHaveLength(1);
    expect(images[0].id).toBe("sha256:abc");
    expect(images[0].sizeMb).toBe(150);
  });
});
