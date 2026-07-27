import { describe, expect, it } from "vite-plus/test";

import { ORG_NAV_GROUPS } from "@/features/command-palette/components/nav-items";
import { OPERATIONAL_NAV, SETTINGS_NAV } from "@/features/shell/nav-manifest";

/**
 * The manifest promises that editing it alone keeps three surfaces in sync
 * (sidebar, settings rail, command palette). These guard the couplings that
 * promise cannot express in the type system.
 */
describe("nav manifest", () => {
  // The palette headings the unlabelled top group with a hard-coded fallback
  // string and uses `heading` as a React key. Adding an OPERATIONAL_NAV group
  // whose label equals that fallback silently produces a duplicate key and two
  // identically-headed palette sections — which is exactly what happened when
  // the "Workspace" group was added (the fallback was "Workspace" too).
  it("palette group headings are unique", () => {
    const headings = ORG_NAV_GROUPS.map((g) => g.heading);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it("every destination appears exactly once across both chromes", () => {
    const paths = [
      ...OPERATIONAL_NAV.flatMap((g) => g.items.map((i) => i.to)),
      ...SETTINGS_NAV.flatMap((g) => g.items.map((i) => i.to)),
    ];
    expect(new Set(paths).size).toBe(paths.length);
  });

  // A page that moved chromes must not be left behind in the one it came from:
  // two nav entries pointing at the same page (one of them through a redirect
  // shim) is how a "moved" page keeps appearing in its old home.
  it("no settings entry points at a page the operational shell owns", () => {
    const operational = new Set(OPERATIONAL_NAV.flatMap((g) => g.items.map((i) => i.to)));
    for (const group of SETTINGS_NAV) {
      for (const item of group.items) {
        const asOperational = String(item.to)
          .replace("/settings/workspace", "")
          .replace("/settings", "");
        expect(operational.has(asOperational as typeof item.to), `${item.title} → ${item.to}`).toBe(
          false,
        );
      }
    }
  });

  it("moved workspace destinations live in the sidebar, not settings", () => {
    const sidebar = OPERATIONAL_NAV.flatMap((g) => g.items.map((i) => i.to));
    for (const path of ["/$orgSlug/git-providers", "/$orgSlug/registries", "/$orgSlug/ssh-keys"]) {
      expect(sidebar, path).toContain(path);
    }
    // API keys deliberately stayed: programmatic access to otterdeploy itself
    // is configuration, not something a deployment reaches for.
    const settings = SETTINGS_NAV.flatMap((g) => g.items.map((i) => i.to));
    expect(settings).toContain("/$orgSlug/settings/workspace/api-keys");
  });
});
