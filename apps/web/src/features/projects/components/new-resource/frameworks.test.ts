import { describe, expect, it } from "vite-plus/test";

import { frameworkDefaultServiceType, pickDefaultMonorepoApp } from "./frameworks";

describe("frameworkDefaultServiceType", () => {
  it("defaults SPA/static frameworks to a static site", () => {
    for (const fw of ["vite", "react", "vue", "astro", "static"]) {
      expect(frameworkDefaultServiceType(fw)).toBe("static");
    }
  });

  it("defaults server frameworks to a web app", () => {
    for (const fw of ["next", "nuxt", "remix", "sveltekit", "hono", "express", "nest", "go", "python"]) {
      expect(frameworkDefaultServiceType(fw)).toBe("app");
    }
  });

  it("defaults to a web app when nothing was detected", () => {
    expect(frameworkDefaultServiceType(null)).toBe("app");
    expect(frameworkDefaultServiceType(undefined)).toBe("app");
  });
});

describe("pickDefaultMonorepoApp", () => {
  it("prefers an apps/* package over packages/*", () => {
    expect(pickDefaultMonorepoApp(["packages/ui", "apps/api", "packages/config"])).toBe("apps/api");
  });

  it("ranks conventional app names first among apps/*", () => {
    expect(pickDefaultMonorepoApp(["apps/api", "apps/web", "apps/worker"])).toBe("apps/web");
    expect(pickDefaultMonorepoApp(["apps/worker", "apps/server"])).toBe("apps/server");
  });

  it("falls back to the first package when there is no apps/ folder", () => {
    expect(pickDefaultMonorepoApp(["packages/site", "packages/lib"])).toBe("packages/site");
  });

  it("returns null for an empty package list", () => {
    expect(pickDefaultMonorepoApp([])).toBeNull();
  });
});
