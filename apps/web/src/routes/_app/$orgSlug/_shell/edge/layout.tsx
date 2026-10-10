/**
 * Org-level Edge: the single home for everything the Caddy edge does:
 * the install-wide rendered Caddyfile, TLS certificates (managed/custom/CA),
 * the per-request access log, operational events (cert/ACME lifecycle,
 * upstream errors), and CrowdSec firewall decisions. Previously split across
 * Networking, Edge logs and Settings → Certificates, consolidated here
 * (od-u63.1) because they're all facets of one concept: what the edge is
 * doing right now. Content is unchanged from those pages; only the chrome
 * that wraps it moved.
 *
 * Layout: Access logs is the landing tab (the thing people open this page
 * for), then a "Caddy" tab grouping the proxy's own facets behind a left
 * sidebar (Config = rendered Caddyfile, Events, Certs), then Firewall.
 *
 * The Config pane and Firewall tab are backed by routers that are
 * install-admin in their entirety (`system.caddyfile`, `firewall.status` /
 * `firewall.decisions`), so both are OMITTED for anyone else rather than
 * rendered-and-403'd (see `resolveEdgeView`). Certs is role-gated instead
 * (`certificate:read`) and keeps its own in-plane notice; Access logs and
 * Events are org-scoped and always shown.
 */
import { useState } from "react";

import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { FIREWALL_TABS } from "@/features/firewall/tabs";
import { pickView, useRouteView } from "@/shared/hooks/use-route-view";

import { UploadCaDialog } from "@/features/certificates/upload-ca-dialog";
import { UploadCertDialog } from "@/features/certificates/upload-cert-dialog";
import { EdgeEventsTable } from "@/features/edge-logs/table/events-table";
import { EdgeAccessTable } from "@/features/edge-logs/table/access-table";
import { FirewallView } from "@/features/firewall/components/firewall-view";
import { prefetchEdge } from "./-components/edge-prefetch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { queryClient } from "@/shared/server/orpc";

import {
  CERT_TABS,
  CertificatesActions,
  CertificatesTab,
} from "./-components/edge-certificates";
import {
  CADDY_PANES,
  type CaddyPane,
  CERT_PATHS,
  EDGE_PATHS,
  EDGE_TABS,
  FIREWALL_PATHS,
  type EdgeTab,
  isEdgeTab,
  resolveEdgeView,
  zEdgeSearch,
} from "./-components/edge-search";
import { CaddyfileActions, CaddyfileTab, CaddyPaneLink } from "./-components/caddy-panes";
import { CrowdsecCard } from "./-components/instance-crowdsec";

export const Route = createFileRoute("/_app/$orgSlug/_shell/edge")({
  staticData: { crumb: "Edge" },
  validateSearch: zEdgeSearch,
  component: RouteComponent,
  // Warm the two heaviest queries on hover (intent-preload) so the default
  // and certificates planes render from cache instead of spinning.
  // Non-blocking + best-effort: a permission-gated or failed prefetch just
  // falls back to fetch-on-mount.
  loader: ({ context }) => {
    prefetchEdge(queryClient, context.isInstallAdmin);
  },
});

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  const { isInstallAdmin } = Route.useRouteContext();
  const search = Route.useSearch();
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const view = useRouteView();
  const { tab, pane } = resolveEdgeView(
    {
      tab: pickView(view, 0, EDGE_TABS, "logs"),
      pane: CADDY_PANES.find((p) => p === view[1]),
    },
    isInstallAdmin,
  );
  const certTab = pickView(view, 2, CERT_TABS, "managed");
  const firewallTab = pickView(view, 1, FIREWALL_TABS, "blocked");
  const navigate = Route.useNavigate();
  // Each plane is a route. Navigating with an empty search drops the table
  // filters of the plane being left.
  const setPane = (next: CaddyPane) =>
    navigate({ to: EDGE_PATHS[next], params: { orgSlug }, search: {}, replace: true });
  const setTab = (next: EdgeTab) =>
    next === "caddy"
      ? setPane(pane)
      : navigate({ to: EDGE_PATHS[next], params: { orgSlug }, search: {}, replace: true });
  // The two tables on this route hold their filters in the URL. They merge a
  // patch; `setTab` / `setPane` above deliberately do not, so switching pane
  // clears them.
  const onSearchChange = (patch: Record<string, unknown>) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };

  // Lifted so the header-row "Upload" buttons and the Certs pane's own
  // "Upload" affordances (Custom / Trusted CAs sub-tabs) drive the same two
  // dialog instances instead of each owning a redundant copy.
  const [uploadCertOpen, setUploadCertOpen] = useState(false);
  const [uploadCaOpen, setUploadCaOpen] = useState(false);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        if (isEdgeTab(value)) void setTab(value);
      }}
      className="flex h-[calc(100svh-var(--header-height))] min-w-0 flex-col gap-0 overflow-hidden"
    >
      {/* Tabs are the only title bar here; the page is still named. */}
      <h1 className="sr-only">Edge</h1>
      <div className="flex items-center justify-between gap-3 border-b px-4 pt-2 pb-2">
        <TabsList variant="line" className="h-auto bg-transparent p-0">
          <TabsTrigger value="logs" className="px-3 py-2">
            Access logs
          </TabsTrigger>
          <TabsTrigger value="caddy" className="px-3 py-2">
            Caddy
          </TabsTrigger>
          {isInstallAdmin ? (
            <TabsTrigger value="firewall" className="px-3 py-2">
              Firewall
            </TabsTrigger>
          ) : null}
        </TabsList>
        {tab === "caddy" && pane === "config" ? <CaddyfileActions /> : null}
        {tab === "caddy" && pane === "certs" ? (
          <CertificatesActions onUploadCert={() => setUploadCertOpen(true)} />
        ) : null}
      </div>

      <TabsContent value="logs" className="flex min-h-0 flex-1 flex-col">
        <EdgeAccessTable search={search} onSearchChange={onSearchChange} />
      </TabsContent>

      <TabsContent value="caddy" className="min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-w-0">
          <nav className="flex w-36 shrink-0 flex-col gap-0.5 border-r p-2">
            {/* Not just hidden, unmounted below: `useCaddyfileQuery` must
                never run for a viewer who would only get a 403 out of it. */}
            {isInstallAdmin ? (
              <CaddyPaneLink active={pane === "config"} onClick={() => void setPane("config")}>
                Config
              </CaddyPaneLink>
            ) : null}
            <CaddyPaneLink active={pane === "events"} onClick={() => void setPane("events")}>
              Events
            </CaddyPaneLink>
            <CaddyPaneLink active={pane === "certs"} onClick={() => void setPane("certs")}>
              Certs
            </CaddyPaneLink>
          </nav>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {pane === "config" && isInstallAdmin ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <CaddyfileTab />
              </div>
            ) : null}
            {pane === "events" ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <EdgeEventsTable />
              </div>
            ) : null}
            {pane === "certs" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <CertificatesTab
                  orgSlug={orgSlug}
                  tab={certTab}
                  onTabChange={(next) =>
                    void navigate({ to: CERT_PATHS[next], params: { orgSlug }, replace: true })
                  }
                  onUploadCert={() => setUploadCertOpen(true)}
                  onUploadCa={() => setUploadCaOpen(true)}
                />
              </div>
            ) : null}
          </div>
        </div>
      </TabsContent>

      {isInstallAdmin ? (
        <TabsContent value="firewall" className="min-h-0 flex-1">
          {/* The CrowdSec agent's own settings sit with the sources it pulls
              from; moved here from Instance settings. */}
          {firewallTab === "sources" ? (
            <div className="border-b p-4">
              <CrowdsecCard organizationId={organization.id} />
            </div>
          ) : null}
          <FirewallView
            tab={firewallTab}
            onTabChange={(next) =>
              void navigate({ to: FIREWALL_PATHS[next], params: { orgSlug }, replace: true })
            }
          />
        </TabsContent>
      ) : null}

      <UploadCertDialog open={uploadCertOpen} onOpenChange={setUploadCertOpen} />
      <UploadCaDialog open={uploadCaOpen} onOpenChange={setUploadCaOpen} />
    </Tabs>
  );
}

