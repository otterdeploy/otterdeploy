import { describe, expect, it } from "vite-plus/test";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";

import { resourceDefaults } from "../schemas";
import { buildReviewModel } from "../steps/review-model";

function review(kindId: string, version: string) {
  const kind = SERVICE_KINDS.find((k) => k.id === kindId);
  if (!kind) throw new Error(`no kind ${kindId}`);
  return buildReviewModel(kind, { ...resourceDefaults, kindId, name: "db", version }, null);
}

describe("database review: where the data volume mounts", () => {
  it("shows postgres 18 at /var/lib/postgresql, where the runtime mounts it", () => {
    const model = review("postgres", "18-alpine");
    expect(model.mountTarget).toBe("/var/lib/postgresql");
    expect(model.compose).toContain("- db-data:/var/lib/postgresql\n");
  });

  it("keeps postgres 17 at /var/lib/postgresql/data", () => {
    const model = review("postgres", "17-alpine");
    expect(model.mountTarget).toBe("/var/lib/postgresql/data");
    expect(model.compose).toContain("- db-data:/var/lib/postgresql/data\n");
  });

  it("leaves other engines on their data dir", () => {
    expect(review("redis", "8-alpine").mountTarget).toBe("/data");
  });
});
