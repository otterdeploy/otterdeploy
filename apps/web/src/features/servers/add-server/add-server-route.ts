/**
 * Where the Add a server dialog lives: `/$org/servers/new/command` and
 * `/$org/servers/new/ssh`, child routes that render the dialog over the
 * Servers page.
 *
 * A method is a tab, and a tab is a route (shared/router.d.ts `view`): it can
 * be linked, reloaded and left with Back. Every entry point (the page button,
 * the empty fleet, the command palette, a failed server's Re-add) links here
 * rather than toggling local state.
 */

import { idSchema } from "@otterdeploy/shared/id";
import * as z from "zod";

import { pickView } from "@/shared/hooks/use-route-view";

export const ADD_SERVER_METHODS = ["command", "ssh"] as const;
export type AddServerMethod = (typeof ADD_SERVER_METHODS)[number];

/** Each method route's `staticData.view`, read back by the dialog's tab strip. */
export const ADD_SERVER_VIEW = {
  command: ["command"],
  ssh: ["ssh"],
} as const satisfies Record<AddServerMethod, readonly [AddServerMethod]>;

const ADD_SERVER_PATHS = {
  command: "/$orgSlug/servers/new/command",
  ssh: "/$orgSlug/servers/new/ssh",
} as const satisfies Record<AddServerMethod, string>;

/**
 * `?from=<server>` on the SSH tab: re-add a failed server with everything but
 * its secret filled in. Anything that is not a server id is dropped rather than
 * failing the route, so a mangled link still opens a blank form.
 */
export const addServerSearchSchema = z.object({
  from: idSchema.server.optional().catch(undefined),
});

/** The tab the URL names. `/servers/new` itself redirects to Command. */
export function addServerMethod(view: readonly string[]): AddServerMethod {
  return pickView(view, 0, ADD_SERVER_METHODS, "command");
}

/**
 * Navigation for a tab switch. Replace, not push: Back closes the dialog
 * instead of replaying each tab the user looked at. Search is not carried, so a
 * re-add prefill belongs to the SSH visit that asked for it.
 */
export function methodLocation(orgSlug: string, method: AddServerMethod) {
  return { to: ADD_SERVER_PATHS[method], params: { orgSlug }, replace: true } as const;
}
