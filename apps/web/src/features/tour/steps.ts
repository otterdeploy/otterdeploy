/**
 * The product tour's script.
 *
 * One ordered list, grouped into chapters that follow the real journey an
 * operator takes: orient in the shell → connect a machine → open a project →
 * add a service → watch it deploy → find it again in logs. Each step names a
 * surface that exists today; nothing here demos a "Coming soon" feature, so
 * the tour can't promise something the app won't do (PRODUCT.md, honest state).
 *
 * Steps are declarative so the engine can do the awkward parts. Cross-route
 * navigation, waiting for an element to mount, skipping a chapter whose
 * subject the org doesn't have yet.
 *
 * Selector policy: prefer a `data-tour` anchor (added at the call site), then
 * a semantic landmark (`nav[aria-label="Project"]`), then a component's
 * `data-slot`. Never a Tailwind class: those change with styling.
 */

import type { Translation } from "@otterdeploy/i18n";
import type { Alignment, Side } from "driver.js";

/**
 * Step ids are exactly the keys the tour has copy for.
 *
 * Deriving the union from the English bundle means a step added here without
 * copy fails `tsc`, and the `tour.steps.${id}.title` lookups in the provider
 * resolve to real keys instead of collapsing to `string`.
 */
export type TourStepId = keyof Translation["tour"]["steps"];

/** What the engine knows about the viewer when it builds the script. */
export interface TourContext {
  orgSlug: string;
  /** Slug of the project the tour will walk through, when the org has one. */
  projectSlug: string | null;
  hasServers: boolean;
  isInstallAdmin: boolean;
}

export interface TourStepRoute {
  to: string;
  params: Record<string, string>;
}

export interface TourStep {
  /** Stable id: also the i18n key suffix (`tour.steps.<id>.title`). */
  id: TourStepId;
  /**
   * Element to highlight. Omitted for a centered step, which driver.js renders
   * as a modal with no cutout, used for the opening and closing beats.
   */
  element?: string;
  /** Navigate here before the step is shown. */
  route?: TourStepRoute;
  side?: Side;
  align?: Alignment;
  /** Drop the step when the context can't support it. */
  when?: (ctx: TourContext) => boolean;
}

const inProject = (ctx: TourContext): boolean => ctx.projectSlug !== null;

/**
 * Chapter 1: the shell. Where things live and how to get anywhere fast.
 */
const ORIENTATION: readonly TourStep[] = [
  {
    id: "welcome",
    route: { to: "/$orgSlug", params: {} },
  },
  {
    id: "sidebar",
    element: '[data-slot="sidebar-content"]',
    side: "right",
    align: "start",
  },
  {
    id: "projects",
    element: '[data-tour="nav-projects"]',
    side: "right",
    align: "start",
  },
  {
    id: "infrastructure",
    element: '[data-tour="nav-servers"]',
    side: "right",
    align: "start",
  },
  {
    id: "edge",
    element: '[data-tour="nav-edge"]',
    side: "right",
    align: "start",
  },
  {
    id: "search",
    element: '[data-tour="command-palette"]',
    side: "bottom",
    align: "end",
  },
  {
    id: "activity",
    element: '[data-tour="header-actions"]',
    side: "bottom",
    align: "end",
  },
];

/**
 * Chapter 2: servers. Nothing deploys until a machine has joined the swarm,
 * so this comes before anything project-shaped.
 */
const SERVERS: readonly TourStep[] = [
  {
    id: "serversPage",
    route: { to: "/$orgSlug/servers", params: {} },
    element: '[data-tour="page-header"]',
    side: "bottom",
    align: "start",
  },
  {
    id: "addServer",
    element: '[data-tour="add-server"]',
    side: "bottom",
    align: "end",
  },
  {
    id: "enrollment",
    element: '[data-tour="secure-enrollment"]',
    side: "bottom",
    align: "end",
  },
];

/**
 * Chapter 3: a project. Skipped wholesale when the org has none: a tour that
 * highlights an empty canvas teaches nothing.
 */
const PROJECT: readonly TourStep[] = [
  {
    id: "projectGraph",
    route: { to: "/$orgSlug/$projectSlug/graph", params: {} },
    element: ".react-flow",
    side: "top",
    align: "center",
    when: inProject,
  },
  {
    id: "projectTabs",
    element: 'nav[aria-label="Project"]',
    side: "bottom",
    align: "start",
    when: inProject,
  },
  {
    id: "newService",
    element: '[data-tour="new-service"]',
    side: "bottom",
    align: "end",
    when: inProject,
  },
  {
    id: "deployments",
    route: { to: "/$orgSlug/$projectSlug/deployments", params: {} },
    element: '[data-tour="project-tab-deployments"]',
    side: "bottom",
    align: "start",
    when: inProject,
  },
  {
    id: "logs",
    route: { to: "/$orgSlug/$projectSlug/logs", params: {} },
    element: '[data-tour="project-tab-logs"]',
    side: "bottom",
    align: "start",
    when: inProject,
  },
  {
    id: "variables",
    route: { to: "/$orgSlug/$projectSlug/variables", params: {} },
    element: '[data-tour="project-tab-variables"]',
    side: "bottom",
    align: "start",
    when: inProject,
  },
  {
    id: "networking",
    route: { to: "/$orgSlug/$projectSlug/networking", params: {} },
    element: '[data-tour="project-tab-networking"]',
    side: "bottom",
    align: "start",
    when: inProject,
  },
];

/** Chapter 4: where to go next, and how to get this tour back. */
const CLOSING: readonly TourStep[] = [
  {
    id: "help",
    route: { to: "/$orgSlug", params: {} },
    element: '[data-tour="user-menu"]',
    side: "right",
    align: "end",
  },
  { id: "done" },
];

const SCRIPT: readonly TourStep[] = [...ORIENTATION, ...SERVERS, ...PROJECT, ...CLOSING];

/** The steps that apply to this viewer, in order. */
export function buildTourSteps(ctx: TourContext): TourStep[] {
  return SCRIPT.filter((step) => step.when === undefined || step.when(ctx));
}

/** Resolve a step's route params against the current org/project. */
export function resolveRouteParams(route: TourStepRoute, ctx: TourContext): Record<string, string> {
  const params: Record<string, string> = { ...route.params, orgSlug: ctx.orgSlug };
  if (ctx.projectSlug !== null) params.projectSlug = ctx.projectSlug;
  return params;
}
