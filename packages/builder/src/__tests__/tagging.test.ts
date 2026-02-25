import { describe, it, expect, vi, beforeEach } from "vitest";
import { getImageName, getImageTag, tagAsLatest, pruneOldTags } from "../tagging";

vi.mock("@otterdeploy/docker", () => ({
  tagImage: vi.fn(),
  listImages: vi.fn(),
  removeImage: vi.fn(),
}));

vi.mock("@otterdeploy/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { tagImage, listImages, removeImage } from "@otterdeploy/docker";
import { Result } from "better-result";

describe("getImageName", () => {
  it("returns otterstack-prefixed name", () => {
    expect(getImageName("my-resource")).toBe("otterstack-my-resource");
  });

  it("handles resource IDs with special characters", () => {
    expect(getImageName("abc-123-def")).toBe("otterstack-abc-123-def");
  });
});

describe("getImageTag", () => {
  it("returns versioned tag", () => {
    expect(getImageTag(1)).toBe("v1");
    expect(getImageTag(42)).toBe("v42");
  });
});

describe("tagAsLatest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tags the versioned image as latest", async () => {
    vi.mocked(tagImage).mockResolvedValue(Result.ok(undefined));

    const result = await tagAsLatest("my-resource", 5);

    expect(result.isOk()).toBe(true);
    expect(tagImage).toHaveBeenCalledWith(
      "otterstack-my-resource:v5",
      "otterstack-my-resource:latest",
    );
  });

  it("returns error when tagImage fails", async () => {
    vi.mocked(tagImage).mockResolvedValue(Result.err(new Error("tag failed")));

    const result = await tagAsLatest("my-resource", 3);

    expect(result.isErr()).toBe(true);
  });
});

describe("pruneOldTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes tags beyond the keep count", async () => {
    const mockImages = [
      { id: "sha1", repoTags: ["otterstack-res:v1"], sizeMb: 100, created: 1 },
      { id: "sha2", repoTags: ["otterstack-res:v2"], sizeMb: 100, created: 2 },
      { id: "sha3", repoTags: ["otterstack-res:v3"], sizeMb: 100, created: 3 },
    ];

    vi.mocked(listImages).mockResolvedValue(Result.ok(mockImages));
    vi.mocked(removeImage).mockResolvedValue(Result.ok(undefined));

    const result = await pruneOldTags("res", 2);

    expect(result.isOk()).toBe(true);
    const removed = result.unwrap();
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe("otterstack-res:v1");
    expect(removeImage).toHaveBeenCalledWith("otterstack-res", "v1");
  });

  it("does not remove anything when under keep count", async () => {
    const mockImages = [
      { id: "sha1", repoTags: ["otterstack-res:v1"], sizeMb: 100, created: 1 },
      { id: "sha2", repoTags: ["otterstack-res:v2"], sizeMb: 100, created: 2 },
    ];

    vi.mocked(listImages).mockResolvedValue(Result.ok(mockImages));

    const result = await pruneOldTags("res", 10);

    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toHaveLength(0);
    expect(removeImage).not.toHaveBeenCalled();
  });

  it("returns error when listImages fails", async () => {
    vi.mocked(listImages).mockResolvedValue(Result.err(new Error("list failed")));

    const result = await pruneOldTags("res");

    expect(result.isErr()).toBe(true);
  });
});
