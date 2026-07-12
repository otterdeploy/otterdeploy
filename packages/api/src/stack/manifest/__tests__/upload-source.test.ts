import { describe, expect, it } from "vite-plus/test";

import { manifestSchema } from "../schema";

function parse(web: Record<string, unknown>) {
  return manifestSchema.safeParse({
    project: "acme-api",
    services: { web },
  });
}

describe("source: upload manifest variant", () => {
  it("accepts an upload service with build/subdir/ports", () => {
    const result = parse({
      source: "upload",
      sourceSubdir: "apps/api",
      ports: [{ container: 3000, appProtocol: "http", primary: true }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services.web).toMatchObject({ source: "upload", sourceSubdir: "apps/api" });
    }
  });

  it("accepts a bare upload service (no subdir)", () => {
    expect(parse({ source: "upload" }).success).toBe(true);
  });

  it("strips git-only fields from an upload service", () => {
    // `repo` belongs to the git variant; on an upload service it's an unknown
    // key, which the (non-strict) schema drops rather than carrying through.
    const result = parse({ source: "upload", repo: "acme/api" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services.web).not.toHaveProperty("repo");
    }
  });
});
