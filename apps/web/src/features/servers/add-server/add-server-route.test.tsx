import { renderToString } from "react-dom/server";

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import { ADD_SERVER_VIEW, addServerSearchSchema, methodLocation } from "./add-server-route";
import { AddServerTabs } from "./add-server-tabs";

/**
 * The dialog's tab is its URL: `/servers/new/command` and `/servers/new/ssh`.
 * This router has the same shape as the real one (a layout at `servers/new`
 * rendering the tab strip, a leaf route per method declaring its view) so the
 * tests drive the real strip and the real navigation targets.
 */
function routerAt(path: string) {
  const root = createRootRoute({ component: Outlet });
  const layout = createRoute({
    getParentRoute: () => root,
    path: "$orgSlug/servers/new",
    component: () => <AddServerTabs showList />,
  });
  const command = createRoute({
    getParentRoute: () => layout,
    path: "command",
    staticData: { view: ADD_SERVER_VIEW.command },
  });
  const ssh = createRoute({
    getParentRoute: () => layout,
    path: "ssh",
    staticData: { view: ADD_SERVER_VIEW.ssh },
    validateSearch: addServerSearchSchema,
  });
  return createRouter({
    routeTree: root.addChildren([layout.addChildren([command, ssh])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

async function selectedTab(router: ReturnType<typeof routerAt>): Promise<string | undefined> {
  await router.load();
  const html = renderToString(<RouterProvider router={router} />);
  // base-ui marks the active trigger with aria-selected; the label is its text.
  return /aria-selected="true"[^>]*>(?:<[^>]+>)*([A-Za-z]+)/.exec(html)?.[1];
}

describe("add-server tab follows the URL", () => {
  it("opens on the Command tab at /servers/new/command", async () => {
    expect(await selectedTab(routerAt("/acme/servers/new/command"))).toBe("Command");
  });

  it("opens on the SSH tab at /servers/new/ssh, so a refresh keeps the tab", async () => {
    expect(await selectedTab(routerAt("/acme/servers/new/ssh"))).toBe("SSH");
  });
});

describe("switching tabs changes the URL", () => {
  it("moves to the other method's path without adding a history entry", async () => {
    const router = routerAt("/acme/servers/new/command");
    await router.load();
    const before = router.history.length;

    await router.navigate(methodLocation("acme", "ssh"));

    expect(router.state.location.pathname).toBe("/acme/servers/new/ssh");
    // Replace, not push: Back leaves the dialog instead of stepping through
    // every tab the user looked at.
    expect(router.history.length).toBe(before);
    expect(await selectedTab(router)).toBe("SSH");
  });

  it("drops a re-add prefill when leaving the SSH tab", async () => {
    const router = routerAt("/acme/servers/new/ssh?from=srv_0123456789abcdefghijk");
    await router.load();

    await router.navigate(methodLocation("acme", "command"));

    expect(router.state.location.pathname).toBe("/acme/servers/new/command");
    expect(router.state.location.search).toEqual({});
  });
});

describe("addServerSearchSchema", () => {
  it("keeps a server id to prefill a re-add", () => {
    expect(addServerSearchSchema.parse({ from: "srv_0123456789abcdefghijk" })).toEqual({
      from: "srv_0123456789abcdefghijk",
    });
  });

  it("drops anything that is not a server id instead of failing the route", () => {
    expect(addServerSearchSchema.parse({ from: "prj_0123456789abcdefghijk" })).toEqual({
      from: undefined,
    });
    expect(addServerSearchSchema.parse({ from: 42 })).toEqual({ from: undefined });
    expect(addServerSearchSchema.parse({})).toEqual({ from: undefined });
  });
});
