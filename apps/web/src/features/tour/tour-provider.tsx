/**
 * Product tour — provider, engine, and the hook the rest of the app starts it
 * from.
 *
 * driver.js drives one flat step list; everything route-shaped is ours:
 *
 *   - **Cross-route steps.** A step may name a route. Navigation happens on
 *     the click that leaves the previous step, then driver waits for the next
 *     step's element to mount (`waitForElement`) — so the tour walks the
 *     operator through the real app rather than describing it from one page.
 *   - **Missing anchors never dead-end.** `skipMissingElement` means a surface
 *     that isn't rendered for this viewer (an install-admin-only nav item, a
 *     button that needs a project) is stepped over instead of stalling the
 *     tour on an element that will never appear.
 *   - **Copy is translated at build time**, not baked into the step list —
 *     `t()` is called when the driver step is constructed, so the tour speaks
 *     whatever language the user picked.
 *
 * Mounted in the `_app` layout: inside the auth gate (so org/user context
 * exists) and outside the two chromes (so it survives navigation between
 * them).
 */

import { createContext, use, useCallback, useEffect, useMemo, useRef } from "react";

import { useLiveQuery } from "@tanstack/react-db";
import { useNavigate, useParams, useRouteContext } from "@tanstack/react-router";
import { driver, type DriveStep, type Driver } from "driver.js";
import { useTranslation } from "react-i18next";

import { projectCollection } from "@/features/projects/data/project";
import { serverCollection } from "@/features/servers/data/server";

import { buildTourSteps, resolveRouteParams, type TourContext, type TourStep } from "./steps";
import { hasSeenTour, markTourCompleted, markTourDismissed } from "./storage";

import "driver.js/dist/driver.css";

import "./tour.css";

interface TourApi {
  /** Start (or restart) the tour from the first step. */
  start: () => void;
  /** True while the tour is on screen. */
  isActive: () => boolean;
}

const TourApiContext = createContext<TourApi | null>(null);

/**
 * How long driver.js waits for a step's element after a route change. Route
 * transitions here are client-side and usually resolve in well under a second;
 * a project graph mounting React Flow is the slow end.
 */
const WAIT_FOR_ELEMENT_MS = 2500;

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { activeOrgSlug, isInstallAdmin } = useRouteContext({ from: "/_app" });
  // `strict: false` — the tour is mounted above the routes that own these
  // params, so it reads whichever are present on the current match.
  const params = useParams({ strict: false }) as { orgSlug?: string; projectSlug?: string };

  // Both collections are preloaded by the layouts below this one, so these are
  // cheap subscriptions rather than fetches. They decide which chapters apply:
  // a tour of the project surface needs a project to walk through.
  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);
  const { data: servers } = useLiveQuery((q) => q.from({ s: serverCollection }), []);

  const orgSlug = params.orgSlug ?? activeOrgSlug;
  // Walk the project the operator is already looking at; otherwise their first
  // one. Sorted by name so a repeat run picks the same project, not whichever
  // the collection happened to return first.
  const projectSlug = useMemo(() => {
    if (params.projectSlug !== undefined) return params.projectSlug;
    const sorted = [...projects].sort((a, b) => a.slug.localeCompare(b.slug));
    return sorted[0]?.slug ?? null;
  }, [params.projectSlug, projects]);

  const ctx: TourContext = useMemo(
    () => ({
      orgSlug,
      projectSlug,
      hasServers: servers.length > 0,
      isInstallAdmin,
    }),
    [orgSlug, projectSlug, servers.length, isInstallAdmin],
  );

  // The live driver instance. Held in a ref so `start` is stable and a
  // re-render mid-tour can't swap the engine out from under the user.
  const driverRef = useRef<Driver | null>(null);

  // Destroy an in-flight tour if the provider unmounts (sign-out, org switch)
  // — otherwise the overlay outlives the app tree that anchored it.
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
      driverRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    // A second start while running would leave the first overlay orphaned.
    driverRef.current?.destroy();

    // Built from the context as it stands when the tour opens. The script
    // is fixed for the run, so its steps and their route params must come
    // from one consistent snapshot rather than drifting mid-tour.
    const steps = buildTourSteps(ctx);

    /** Navigate to a step's route, when it names one and we aren't there. */
    const goToStepRoute = async (step: TourStep | undefined): Promise<void> => {
      if (step?.route === undefined) return;
      await navigate({
        to: step.route.to,
        params: resolveRouteParams(step.route, ctx),
      });
    };

    const driveSteps: DriveStep[] = steps.map((step, index) => ({
      element: step.element,
      popover: {
        title: t(`tour.steps.${step.id}.title`),
        description: t(`tour.steps.${step.id}.description`),
        side: step.side,
        align: step.align,
        // Navigation belongs on the click that LEAVES a step: by the time the
        // next step is highlighted, driver has already tried to resolve its
        // element. Moving first and letting `waitForElement` cover the
        // transition is what makes a cross-route step land.
        onNextClick: () => {
          const next = steps[index + 1];
          void goToStepRoute(next).then(() => driverRef.current?.moveNext());
        },
        onPrevClick: () => {
          const previous = steps[index - 1];
          void goToStepRoute(previous).then(() => driverRef.current?.movePrevious());
        },
      },
    }));

    const instance = driver({
      steps: driveSteps,
      popoverClass: "otterdeploy-tour",
      showProgress: true,
      // "3 of 14" — mono, and translated so the connector word is right.
      progressText: t("tour.progress", "{{current}} of {{total}}"),
      nextBtnText: t("tour.next", "Next"),
      prevBtnText: t("tour.previous", "Back"),
      doneBtnText: t("tour.done", "Done"),
      // A surface this viewer can't see is stepped over, not stalled on.
      skipMissingElement: true,
      waitForElement: WAIT_FOR_ELEMENT_MS,
      smoothScroll: true,
      allowClose: true,
      // The tour narrates; it doesn't drive. Letting a click on the cutout
      // fall through to the real button would fire real infrastructure
      // actions ("Add server") from inside a walkthrough.
      disableActiveInteraction: true,
      overlayColor: "#141412",
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 8,
      onDestroyed: () => {
        const index = driverRef.current?.getActiveIndex();
        // driver fires this for both outcomes; the last step's Done is the
        // only one that counts as completing.
        const lastIndex = driveSteps.length - 1;
        if (index !== undefined && index >= lastIndex) {
          markTourCompleted();
        } else {
          markTourDismissed(index ?? 0);
        }
      },
    });

    driverRef.current = instance;

    // The first step may name a route too (the tour always opens on the org
    // index, wherever it was started from).
    void goToStepRoute(steps[0]).then(() => instance.drive());
  }, [ctx, navigate, t]);

  const api = useMemo<TourApi>(
    () => ({ start, isActive: () => driverRef.current?.isActive() ?? false }),
    [start],
  );

  return <TourApiContext value={api}>{children}</TourApiContext>;
}

/**
 * Start the product tour from anywhere inside the signed-in app.
 * Throws outside the provider rather than returning a no-op, so a misplaced
 * "Take the tour" button fails loudly in development instead of silently
 * doing nothing in production.
 */
export function useProductTour(): TourApi {
  const api = use(TourApiContext);
  if (api === null) {
    throw new Error("useProductTour must be used within a TourProvider");
  }
  return api;
}

export { hasSeenTour };
