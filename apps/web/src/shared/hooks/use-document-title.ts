/**
 * Sets the document title from the matched route chain.
 *
 * The product name is deliberately NOT appended. A tab that reads
 * "otterdeploy — otterdeploy — otterdeploy" across three windows tells the
 * operator nothing; the favicon already says which app this is, and tab strips
 * truncate from the right, so a suffix is the first thing lost and the last
 * thing useful. The title's job is to say *where you are*.
 *
 * Titles come from the `crumb` each route already declares — `staticData.crumb`
 * for fixed names, `loaderData.crumb` for ones resolved from data (a project or
 * resource name). Nothing needs a bespoke `head()`.
 */

import { useEffect } from "react";

import { useMatches } from "@tanstack/react-router";

/** Shown before the first match resolves, and on any route with no crumb. */
const FALLBACK = "otterdeploy";

/** Separator between the page and its context. A middot, not an em dash — it
 *  reads as "within" rather than as a subtitle. */
const SEP = " · ";

interface CrumbBearing {
  staticData?: { crumb?: string; ambientCrumb?: boolean };
  loaderData?: unknown;
}

function crumbOf(match: CrumbBearing): string | null {
  // Ambient routes (the organization) still crumb for breadcrumbs, but adding
  // them here would put the same suffix on every tab — the exact noise this
  // hook exists to avoid.
  if (match.staticData?.ambientCrumb) return null;

  // Loader crumbs win: they carry the *instance* name ("storefront"), while
  // staticData carries the generic one ("Project").
  const loaded = match.loaderData;
  if (loaded && typeof loaded === "object" && "crumb" in loaded) {
    const value = (loaded as { crumb?: unknown }).crumb;
    if (typeof value === "string" && value.length > 0) return value;
  }
  const staticCrumb = match.staticData?.crumb;
  return typeof staticCrumb === "string" && staticCrumb.length > 0 ? staticCrumb : null;
}

/**
 * Builds "<page> · <context>" from the crumb chain — e.g. "Deployments ·
 * storefront". Only one level of context: the full chain is breadcrumb
 * material, not a tab title, and anything longer just gets truncated away.
 */
function titleFromCrumbs(crumbs: readonly string[]): string {
  const trail = crumbs.filter((c, i) => c !== crumbs[i - 1]);
  const page = trail.at(-1);
  if (!page) return FALLBACK;
  const context = trail.at(-2);
  return context ? `${page}${SEP}${context}` : page;
}

export function useDocumentTitle(): void {
  const matches = useMatches();

  useEffect(() => {
    const crumbs = matches.map(crumbOf).filter((c): c is string => c !== null);
    document.title = titleFromCrumbs(crumbs);
  }, [matches]);
}
