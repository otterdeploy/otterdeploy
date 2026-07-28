/**
 * Offers the tour once, to the operator who has just arrived.
 *
 * Deliberately narrow, because an unrequested overlay on a working dashboard
 * is an interruption, not help:
 *
 *   - Only on a first session (`useIsFirstSession` — the same heuristic that
 *     suppresses the update banner: org younger than 30 minutes, or no
 *     projects yet).
 *   - Only if the tour has never been completed or dismissed on this device.
 *   - Never while a modal or dialog already owns the screen.
 *
 * After that single offer the tour is opt-in from the account menu. Mounted in
 * the operational shell rather than the `_app` layout because the first-session
 * signal reads the org loader data, which only exists below `/$orgSlug`.
 */

import { useEffect, useRef } from "react";

import { useIsFirstSession } from "@/features/updates";

import { hasSeenTour } from "./storage";
import { useProductTour } from "./tour-provider";

/**
 * Let the shell paint and the sidebar's counts settle before the overlay
 * measures anything — driver.js positions against a live rect, so starting on
 * the same frame as the first render anchors to a half-laid-out sidebar.
 */
const SETTLE_MS = 1200;

export function TourAutoStart() {
  const tour = useProductTour();
  const isFirstSession = useIsFirstSession();
  // One offer per mount, even if the first-session signal flickers as the
  // project collection syncs.
  const offered = useRef(false);

  useEffect(() => {
    if (offered.current) return;
    if (!isFirstSession) return;
    if (hasSeenTour()) return;
    // A dialog open on arrival (an invite acceptance, the setup wizard's
    // handoff) owns the screen — the tour would highlight what's behind it.
    if (document.querySelector('[role="dialog"]') !== null) return;

    offered.current = true;
    const timer = window.setTimeout(() => {
      // Re-check: the operator may have opened something during the delay.
      if (document.querySelector('[role="dialog"]') !== null) return;
      tour.start();
    }, SETTLE_MS);

    return () => window.clearTimeout(timer);
  }, [isFirstSession, tour]);

  return null;
}
