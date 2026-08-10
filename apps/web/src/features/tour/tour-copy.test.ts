/**
 * The tour's copy is the product speaking to a new operator, so it's held to
 * the same bar as the rest of the UI: every step has both halves, in both
 * locales, and none of it drifts into the marketing register PRODUCT.md rules
 * out.
 */

import { describe, expect, it } from "vite-plus/test";

import en from "../../../../../packages/i18n/src/locales/en.json";
import es from "../../../../../packages/i18n/src/locales/es.json";
import { buildTourSteps } from "./steps";

// Both chapters' steps — the widest set the tour can show.
const allSteps = buildTourSteps({
  orgSlug: "acme",
  projectSlug: "storefront",
  hasServers: true,
  isInstallAdmin: true,
});

// The per-step copy shape the assertions probe. `| undefined` because the
// whole point of the test is that a step's copy may be missing from a locale.
interface StepCopy { title?: string; description?: string }
const locales = { en, es } as Record<
  string,
  { tour: { steps: Record<string, StepCopy | undefined> } }
>;

describe("tour copy", () => {
  for (const [name, locale] of Object.entries(locales)) {
    it(`${name}: every step has a title and a description`, () => {
      const missing = allSteps
        .map((step) => {
          const copy = locale.tour.steps[step.id];
          const ok =
            typeof copy?.title === "string" &&
            copy.title.length > 0 &&
            typeof copy.description === "string" &&
            copy.description.length > 0;
          return ok ? null : step.id;
        })
        .filter(Boolean);
      expect(missing).toEqual([]);
    });
  }

  it("no step defines copy the script never shows", () => {
    // The reverse direction — every step HAS copy — is a type error now
    // (TourStepId is `keyof Translation["tour"]["steps"]`), so this only has
    // to catch copy left behind after a step is removed.
    const scripted = new Set<string>(allSteps.map((s) => s.id));
    const orphaned = Object.keys(en.tour.steps).filter((id) => !scripted.has(id));
    expect(orphaned).toEqual([]);
  });

  it("stays out of the marketing register", () => {
    // PRODUCT.md: "never cute, never alarmist, never marketing-bright."
    const banned = /\b(amazing|awesome|magic(al)?|effortless|seamless|revolutionary|blazing)\b/i;
    const offenders = Object.entries(en.tour.steps)
      .filter(([, copy]) => {
        const { title, description } = copy as { title: string; description: string };
        return banned.test(title) || banned.test(description);
      })
      .map(([id]) => id);
    expect(offenders).toEqual([]);
  });

  it("keeps a popover's worth of text per step", () => {
    // The popover is capped at 22rem; much past ~340 characters and it stops
    // being a caption and starts being documentation nobody reads mid-tour.
    const tooLong = Object.entries(en.tour.steps)
      .filter(([, copy]) => (copy as { description: string }).description.length > 340)
      .map(([id]) => id);
    expect(tooLong).toEqual([]);
  });
});
