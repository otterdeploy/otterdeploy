import { idSchema } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import { isEnvironmentSlugAllowed } from "./reserved-slugs";
import {
  BASE,
  environmentScope,
  previewHostLabel,
  previewScope,
  previewSlug,
  previewIdOf,
  runtimeServiceName,
  scopeSuffix,
  type PreviewScope,
} from "./scoping";

const scope: PreviewScope = {
  id: idSchema.preview.parse("prev_pr7"),
  slug: "acme-app-pr-7",
  prNumber: 7,
};

describe("preview scoping", () => {
  it("previewSlug is the stable pr-<n> suffix", () => {
    expect(previewSlug(scope)).toBe("pr-7");
  });

  it("runtimeServiceName leaves base deploys untouched (production byte-identical)", () => {
    expect(runtimeServiceName("web", null)).toBe("web");
    expect(runtimeServiceName("web", undefined)).toBe("web");
  });

  it("runtimeServiceName suffixes preview scopes with the pr slug", () => {
    expect(runtimeServiceName("web", scope)).toBe("web-pr-7");
  });

  it("previewHostLabel scopes preview hosts, leaves base alone", () => {
    expect(previewHostLabel("web", null)).toBe("web");
    expect(previewHostLabel("web", scope)).toBe("web-pr-7");
  });
});

describe("scope union", () => {
  it("accepts a bare PreviewScope as well as a lifted one", () => {
    // Every call site that predates the union passes the bare shape; both must
    // resolve identically or the migration renames containers.
    expect(runtimeServiceName("web", scope)).toBe(runtimeServiceName("web", previewScope(scope)));
  });

  it("base is the empty suffix", () => {
    expect(scopeSuffix(BASE)).toBe("");
    expect(scopeSuffix(null)).toBe("");
    expect(scopeSuffix(undefined)).toBe("");
    expect(runtimeServiceName("web", BASE)).toBe("web");
  });
});

describe("environment scoping", () => {
  it("the MAIN environment renders as base", () => {
    // Load-bearing: once resources carry an environmentId, production is an
    // environment too. Suffixing it would rename every running container,
    // volume and host the moment the backfill lands.
    const main = environmentScope({ slug: "production", isMain: true });
    expect(scopeSuffix(main)).toBe("");
    expect(runtimeServiceName("web", main)).toBe("web");
    expect(previewHostLabel("web", main)).toBe("web");
  });

  it("main renders as base regardless of what it is called", () => {
    // The pointer decides, not the slug: a project whose main environment is
    // `staging`, or is named `prod`, must still render as base.
    expect(runtimeServiceName("web", environmentScope({ slug: "staging", isMain: true }))).toBe(
      "web",
    );
    expect(runtimeServiceName("web", environmentScope({ slug: "prod", isMain: true }))).toBe("web");
  });

  it("a non-main environment takes its slug as a suffix", () => {
    const staging = environmentScope({ slug: "staging", isMain: false });
    expect(scopeSuffix(staging)).toBe("-staging");
    expect(runtimeServiceName("web", staging)).toBe("web-staging");
    expect(previewHostLabel("web", staging)).toBe("web-staging");
  });

  it("a non-main environment slugged production is still suffixed", () => {
    // Two projects can both have a `production` slug; only the pointer makes
    // one of them main. Matching on the slug here would collide them.
    expect(runtimeServiceName("web", environmentScope({ slug: "production", isMain: false }))).toBe(
      "web-production",
    );
  });

  it("a pr-shaped environment slug WOULD collide, which is why it is rejected at creation", () => {
    // These two produce the same container name, so nothing here can tell them
    // apart. That is the whole reason `pr-<n>` is refused when an environment
    // is created. See reserved-slugs.test.ts. Pinned here so anyone loosening
    // that validation sees what it was protecting.
    const envPr7 = runtimeServiceName("web", environmentScope({ slug: "pr-7", isMain: false }));
    const previewPr7 = runtimeServiceName("web", scope);
    expect(envPr7).toBe(previewPr7);
    expect(isEnvironmentSlugAllowed("pr-7")).toBe(false);
  });
});

describe("previewIdOf", () => {
  // Deployment rows are keyed by preview, never by environment. Widening the
  // spec builder from PreviewScope to ScopeLike would have started reading an
  // environment scope's fields as a preview's without this narrowing.
  it("returns the id for a preview scope", () => {
    expect(previewIdOf(scope)).toBe(scope.id);
  });

  it("returns null for an environment scope", () => {
    expect(previewIdOf(environmentScope({ slug: "staging", isMain: false }))).toBeNull();
  });

  it("returns null for base and for no scope", () => {
    expect(previewIdOf(BASE)).toBeNull();
    expect(previewIdOf(null)).toBeNull();
    expect(previewIdOf(undefined)).toBeNull();
  });
});
