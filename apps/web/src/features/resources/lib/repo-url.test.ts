import { describe, expect, test } from "vite-plus/test";

import { repoWebUrl } from "@/features/resources/lib/repo-url";

describe("repoWebUrl", () => {
  test("builds a github url from owner/repo", () => {
    expect(repoWebUrl("github", "artzkaizen/platforms-starter-kit")).toBe(
      "https://github.com/artzkaizen/platforms-starter-kit",
    );
  });
  test("strips a trailing .git", () => {
    expect(repoWebUrl("github", "owner/repo.git")).toBe("https://github.com/owner/repo");
  });
  test("returns null for an unknown provider rather than guessing a host", () => {
    expect(repoWebUrl("gitlab", "owner/repo")).toBeNull();
    expect(repoWebUrl(null, "owner/repo")).toBeNull();
  });
  test("returns null for anything that is not owner/repo", () => {
    expect(repoWebUrl("github", "")).toBeNull();
    expect(repoWebUrl("github", "just-a-name")).toBeNull();
    expect(repoWebUrl("github", "https://github.com/owner/repo")).toBeNull();
  });
});
