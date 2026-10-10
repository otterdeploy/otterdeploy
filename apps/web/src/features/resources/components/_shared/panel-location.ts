/**
 * Where a resource panel is, as a route, and where a click should take it.
 *
 * The panel's tab, the deployment it has expanded, and the log it shows are
 * all in the path: `/r/$resource/deployments/$deploymentId`,
 * `/r/$resource/logs/build?deployment=…`. The panels themselves still speak in
 * `tab` + `PanelFocus` (see ./panel-tab.ts); these two functions translate
 * between that vocabulary and the route, so the translation is one tested
 * place rather than a switch in the route file.
 */
import type { LogSource } from "./panel-tab";

export interface PanelLocation {
  /** The open tab; undefined on the panel's index (its own default tab). */
  tab: string | undefined;
  deployment: string | null;
  logSource: LogSource | null;
}

export interface PanelFocusPatch {
  tab?: string;
  deployment?: string | null;
  logSource?: LogSource | null;
}

/** A navigation the route layer turns into a typed `navigate` call. */
export type PanelTarget =
  | { kind: "tab"; tab: string }
  | { kind: "deployment"; deploymentId: string }
  | { kind: "logs"; source: LogSource; deployment: string | null };

const NON_RUNTIME_SOURCES: readonly LogSource[] = ["build", "deploy"];

/** The panel's current state, from the active child route's `view` and the
 *  deployment the URL names (a path param on Deployments, `?deployment=` on
 *  Logs). */
export function panelLocationFromView(
  view: readonly string[],
  ids: { deploymentId?: string; deploymentSearch?: string },
): PanelLocation {
  const tab = view[0];
  const rawSource = tab === "logs" ? view[1] : undefined;
  const logSource = NON_RUNTIME_SOURCES.find((s) => s === rawSource) ?? null;
  const deployment =
    tab === "deployments" ? (ids.deploymentId ?? null) : (ids.deploymentSearch ?? null);
  return { tab, deployment, logSource };
}

/** Apply a focus change (a tab click, "View logs", a source toggle) to the
 *  current location, and say which route that is. */
export function panelTarget(current: PanelLocation, next: PanelFocusPatch): PanelTarget {
  const tab = next.tab ?? current.tab ?? "overview";
  const deployment = next.deployment === undefined ? current.deployment : next.deployment;
  const logSource = next.logSource === undefined ? current.logSource : next.logSource;

  if (tab === "deployments" && deployment) return { kind: "deployment", deploymentId: deployment };
  if (tab === "logs") return { kind: "logs", source: logSource ?? "runtime", deployment };
  return { kind: "tab", tab };
}
