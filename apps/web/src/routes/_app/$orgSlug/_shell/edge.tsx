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

import { ArrowRight01Icon, EarthIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import * as z from "zod";

import { UploadCaDialog } from "@/features/certificates/upload-ca-dialog";
import { UploadCertDialog } from "@/features/certificates/upload-cert-dialog";
import { EdgeEventsView } from "@/features/edge-logs/components/edge-events-view";
import { EdgeLogsView } from "@/features/edge-logs/components/edge-logs-view";
import { FirewallView } from "@/features/firewall/components/firewall-view";
import { CaddyfileViewer } from "@/features/projects/components/networking/caddyfile-viewer";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

import { CertificatesActions, CertificatesTab } from "./-edge-certificates";

/** Top-level planes. `caddy` groups the proxy's own facets (config / events /
 *  certs) behind a left sidebar; access logs land first because that's what
 *  people open this page for. */
const EDGE_TABS = ["logs", "caddy", "firewall"] as const;
type EdgeTab = (typeof EDGE_TABS)[number];

/** Sidebar panes inside the Caddy tab. */
const CADDY_PANES = ["config", "events", "certs"] as const;
type CaddyPane = (typeof CADDY_PANES)[number];

function isEdgeTab(value: string): value is EdgeTab {
  return EDGE_TABS.some((tab) => tab === value);
}

// `.catch` covers both a missing param and a bad value → default to Access
// logs. The two legacy values kept the old flat-tab deep links working:
// `caddyfile` and `certificates` were top-level tabs before the Caddy group
// existed (and `caddy` used to mean the Events plane; it now opens the group,
// which still contains Events one click away).
const EDGE_SEARCH_TABS = ["logs", "caddy", "firewall", "caddyfile", "certificates"] as const;

const zEdgeSearch = z.object({
  tab: z.enum(EDGE_SEARCH_TABS).catch("logs"),
  pane: z.enum(CADDY_PANES).optional().catch(undefined),
});

/** Fold legacy tab values + permissions into a concrete (tab, pane) pair.
 *  Install-admin-only planes (firewall, the rendered Caddyfile) fall back for
 *  everyone else, so a shared deep link never renders a 403 shell. */
function resolveEdgeView(
  search: z.infer<typeof zEdgeSearch>,
  isInstallAdmin: boolean,
): { tab: EdgeTab; pane: CaddyPane } {
  let tab: EdgeTab;
  let pane = search.pane;
  if (search.tab === "caddyfile") {
    tab = "caddy";
    pane ??= "config";
  } else if (search.tab === "certificates") {
    tab = "caddy";
    pane ??= "certs";
  } else {
    tab = search.tab;
  }
  if (!isInstallAdmin && tab === "firewall") tab = "logs";
  pane ??= isInstallAdmin ? "config" : "events";
  if (!isInstallAdmin && pane === "config") pane = "events";
  return { tab, pane };
}

export const Route = createFileRoute("/_app/$orgSlug/_shell/edge")({
  staticData: { crumb: "Edge" },
  validateSearch: zEdgeSearch,
  component: RouteComponent,
  // Warm the two heaviest queries on hover (intent-preload) so the default
  // and certificates planes render from cache instead of spinning.
  // Non-blocking + best-effort: a permission-gated or failed prefetch just
  // falls back to fetch-on-mount.
  loader: ({ context }) => {
    // Install-admin only, and this runs on plain NAVIGATION. An unconditional
    // prefetch is a 403 for every member who so much as hovers the Edge link,
    // whether or not they can ever open the plane. `enabled: false` on the
    // tab's own query would not cover this.
    if (context.isInstallAdmin) {
      void queryClient.prefetchQuery(orpc.system.caddyfile.queryOptions()).catch(() => undefined);
    }
    void queryClient.prefetchQuery(orpc.certificates.inventory.queryOptions()).catch(() => undefined);
    void queryClient.prefetchQuery(orpc.certificates.listCustom.queryOptions()).catch(() => undefined);
    void queryClient.prefetchQuery(orpc.certificates.listCas.queryOptions()).catch(() => undefined);
  },
});

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  const { isInstallAdmin } = Route.useRouteContext();
  const search = Route.useSearch();
  const { tab, pane } = resolveEdgeView(search, isInstallAdmin);
  const navigate = Route.useNavigate();
  // `pane` only means anything inside the Caddy group; keep the URL clean
  // (no stray ?pane=) when leaving it.
  const setTab = (next: EdgeTab) =>
    navigate({
      search: { tab: next, pane: next === "caddy" ? pane : undefined },
      replace: true,
    });
  const setPane = (next: CaddyPane) =>
    navigate({ search: { tab: "caddy", pane: next }, replace: true });

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

      <TabsContent value="logs" className="min-h-0 flex-1">
        <EdgeLogsView />
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
                <CaddyfileTab orgSlug={orgSlug} />
              </div>
            ) : null}
            {pane === "events" ? (
              <div className="min-h-0 flex-1">
                <EdgeEventsView />
              </div>
            ) : null}
            {pane === "certs" ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <CertificatesTab
                  orgSlug={orgSlug}
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
          <FirewallView />
        </TabsContent>
      ) : null}

      <UploadCertDialog open={uploadCertOpen} onOpenChange={setUploadCertOpen} />
      <UploadCaDialog open={uploadCaOpen} onOpenChange={setUploadCaOpen} />
    </Tabs>
  );
}

/** One Caddy-group sidebar entry. A button (not a Link) because the pane is
 *  search-param state on this same route. */
function CaddyPaneLink({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ─── Caddyfile plane (formerly the standalone Networking page) ──────────

function useCaddyfileQuery() {
  return useQuery({ ...orpc.system.caddyfile.queryOptions(), retry: false });
}

function CaddyfileActions() {
  const caddyfile = useCaddyfileQuery();
  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => void caddyfile.refetch()}
      disabled={caddyfile.isFetching}
    >
      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
      Refresh
    </Button>
  );
}

function CaddyfileTab({ orgSlug }: { orgSlug: string }) {
  const caddyfile = useCaddyfileQuery();

  if (caddyfile.isError) {
    return (
      <Empty className="border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon
              icon={EarthIcon}
              strokeWidth={1.6}
              className="size-5 text-muted-foreground"
            />
          </EmptyMedia>
          <EmptyTitle>Platform access required</EmptyTitle>
          <EmptyDescription>
            The install-wide edge configuration is visible to admins and owners. Per-project
            routes live in each project&apos;s Networking tab.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <CaddyfileViewer
        source={caddyfile.data?.caddyfile ?? ""}
        revision={caddyfile.data?.revision}
        loading={caddyfile.isLoading}
      />
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Edge defaults (ACME email, HTTPS redirect) are configured in Instance settings.</span>
        <Link
          to="/$orgSlug/settings/instance/general"
          params={{ orgSlug }}
          className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
        >
          Open Instance settings
          <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} className="size-3" />
        </Link>
      </div>
    </div>
  );
}
