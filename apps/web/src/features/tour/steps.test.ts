import { describe, expect, it } from "vitest";

import { buildTourSteps, resolveRouteParams, type TourContext } from "./steps";

const base: TourContext = {
  orgSlug: "acme",
  projectSlug: "storefront",
  hasServers: true,
  isInstallAdmin: true,
};

describe("buildTourSteps", () => {
  it("opens on a centered welcome step and ends on a centered closing step", () => {
    const steps = buildTourSteps(base);
    // A centered step (no element) is driver.js's modal form — the right shape
    // for a beat that introduces or closes rather than points at something.
    expect(steps[0].id).toBe("welcome");
    expect(steps[0].element).toBeUndefined();
    expect(steps.at(-1)?.id).toBe("done");
    expect(steps.at(-1)?.element).toBeUndefined();
  });

  it("drops the project chapter when the org has no project to walk through", () => {
    const steps = buildTourSteps({ ...base, projectSlug: null });
    const ids = steps.map((s) => s.id);
    // Highlighting an empty canvas teaches nothing, so the whole chapter goes.
    expect(ids).not.toContain("projectGraph");
    expect(ids).not.toContain("deployments");
    expect(ids).not.toContain("logs");
    // The shell and server chapters still apply — they're what a fresh org
    // actually needs first.
    expect(ids).toContain("sidebar");
    expect(ids).toContain("addServer");
    expect(ids).toContain("done");
  });

  it("keeps the project chapter when a project exists", () => {
    const ids = buildTourSteps(base).map((s) => s.id);
    expect(ids).toContain("projectGraph");
    expect(ids).toContain("networking");
  });

  it("gives every step a unique id, since ids key the i18n copy", () => {
    const ids = buildTourSteps(base).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never points at a Tailwind class, only stable anchors", () => {
    for (const step of buildTourSteps(base)) {
      if (step.element === undefined) continue;
      const stable =
        step.element.startsWith("[data-tour=") ||
        step.element.startsWith("[data-slot=") ||
        step.element.startsWith("nav[aria-label=") ||
        step.element === ".react-flow";
      expect(stable, `${step.id} uses an unstable selector: ${step.element}`).toBe(true);
    }
  });
});

describe("resolveRouteParams", () => {
  it("always supplies orgSlug", () => {
    const params = resolveRouteParams({ to: "/$orgSlug", params: {} }, base);
    expect(params.orgSlug).toBe("acme");
  });

  it("supplies projectSlug only when the context has one", () => {
    const withProject = resolveRouteParams(
      { to: "/$orgSlug/$projectSlug/graph", params: {} },
      base,
    );
    expect(withProject.projectSlug).toBe("storefront");

    const without = resolveRouteParams(
      { to: "/$orgSlug", params: {} },
      {
        ...base,
        projectSlug: null,
      },
    );
    expect(without).not.toHaveProperty("projectSlug");
  });

  it("every routed step resolves the params its path needs", () => {
    for (const step of buildTourSteps(base)) {
      if (step.route === undefined) continue;
      const params = resolveRouteParams(step.route, base);
      // A `$name` segment with no matching param would throw at navigate time.
      for (const segment of step.route.to.split("/")) {
        if (!segment.startsWith("$")) continue;
        expect(params, `${step.id} is missing ${segment}`).toHaveProperty(segment.slice(1));
      }
    }
  });
});
