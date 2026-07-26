/**
 * "First session" heuristic for gating first-run interruptions (currently
 * just the update banner — see `UpdateBanner`). An update nag as literally
 * the first screen after onboarding reads as broken, not helpful.
 *
 * Heuristic (simplest thing that's robust against the two ways "first
 * session" actually shows up):
 *
 *   1. The org was created within the last `FIRST_SESSION_WINDOW_MS` — covers
 *      the operator's own first login right after setup.
 *   2. The org has zero projects yet — covers a teammate's first login into
 *      an already-older org that nobody has deployed anything to yet.
 *
 * Either condition alone would either expire too fast (a slow first project
 * setup) or never (an org that's genuinely been idle for months), so it's an
 * OR: once the org ages past the window AND at least one project exists, the
 * banner is back in play like normal.
 */
import { useLiveQuery } from "@tanstack/react-db";
import { useLoaderData } from "@tanstack/react-router";
import { useState } from "react";

import { projectCollection } from "@/features/projects/data/project";

const FIRST_SESSION_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export function useIsFirstSession(): boolean {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { data: projects } = useLiveQuery((q) => q.from({ p: projectCollection }), []);

  // Pinned at mount rather than read on every render: `Date.now()` in render
  // is impure, and re-reading it could flip the answer mid-session — the
  // banner would pop in the moment the window elapsed under the user.
  const [mountedAt] = useState(() => Date.now());

  const orgAgeMs = mountedAt - new Date(organization.createdAt).getTime();
  const recentlyCreated = Number.isFinite(orgAgeMs) && orgAgeMs < FIRST_SESSION_WINDOW_MS;
  const hasNoProjects = projects.length === 0;

  return recentlyCreated || hasNoProjects;
}
