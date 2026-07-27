/**
 * Org-level Edge — the single home for everything the Caddy edge does:
 * the install-wide rendered Caddyfile, TLS certificates (managed/custom/CA),
 * the per-request access log, operational events (cert/ACME lifecycle,
 * upstream errors), and CrowdSec firewall decisions. Previously split across
 * Networking, Edge logs and Settings → Certificates — consolidated here
 * (od-u63.1) because they're all facets of one concept: what the edge is
 * doing right now. Content is unchanged from those pages; only the chrome
 * that wraps it moved.
 *
 * The Caddyfile and Firewall planes are backed by routers that are
 * install-admin in their entirety (`system.caddyfile`, `firewall.status` /
 * `firewall.decisions`), so those two tabs are OMITTED for anyone else rather
 * than rendered-and-403'd — see `EDGE_TABS_INSTALL_ADMIN` below. Certificates
 * is role-gated instead (`certificate:read`) and keeps its own in-plane
 * notice; Access logs and Events are org-scoped and always shown.
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
import { orpc, queryClient } from "@/shared/server/orpc";

import { CertificatesActions, CertificatesTab } from "./-edge-certificates";

const EDGE_TABS = ["caddyfile", "certificates", "logs", "caddy", "firewall"] as const;
type EdgeTab = (typeof EDGE_TABS)[number];

/** Planes whose every query needs the installation-administrator identity. */
const EDGE_TABS_INSTALL_ADMIN: ReadonlySet<string> = new Set<EdgeTab>(["caddyfile", "firewall"]);

/** The leftmost plane a non-install-admin can see — their default AND the
 *  landing spot when a `?tab=` deep link names one they can't have. Hiding a
 *  trigger while the URL could still select the plane would leave the same
 *  403 one URL away. */
const EDGE_TAB_FALLBACK: EdgeTab = "certificates";

function resolveEdgeTab(tab: EdgeTab, isInstallAdmin: boolean): EdgeTab {
  if (isInstallAdmin || !EDGE_TABS_INSTALL_ADMIN.has(tab)) return tab;
  return EDGE_TAB_FALLBACK;
}

// `.catch` covers both a missing param and a bad value → default to the
// Caddyfile plane, so the page always has a valid controlled tab.
const zEdgeSearch = z.object({
  tab: z.enum(EDGE_TABS).catch("caddyfile"),
});

export const Route = createFileRoute("/_app/$orgSlug/_shell/edge")({
  staticData: { crumb: "Edge" },
  validateSearch: zEdgeSearch,
  component: RouteComponent,
  // Warm the two heaviest queries on hover (intent-preload) so the default
  // and certificates planes render from cache instead of spinning.
  // Non-blocking + best-effort: a permission-gated or failed prefetch just
  // falls back to fetch-on-mount.
  loader: ({ context }) => {
    // Install-admin only, and this runs on plain NAVIGATION — an unconditional
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
  const { tab: requestedTab } = Route.useSearch();
  const tab = resolveEdgeTab(requestedTab, isInstallAdmin);
  const navigate = Route.useNavigate();
  const setTab = (next: EdgeTab) => navigate({ search: { tab: next }, replace: true });

  // Lifted so the header-row "Upload" buttons and the Certificates tab's own
  // "Upload" affordances (Custom / Trusted CAs sub-tabs) drive the same two
  // dialog instances instead of each owning a redundant copy.
  const [uploadCertOpen, setUploadCertOpen] = useState(false);
  const [uploadCaOpen, setUploadCaOpen] = useState(false);

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => setTab(value as EdgeTab)}
      className="flex h-[calc(100svh-var(--header-height))] min-w-0 flex-col gap-0 overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 pt-2 pb-2">
        <TabsList variant="line" className="h-auto bg-transparent p-0">
          {isInstallAdmin ? (
            <TabsTrigger value="caddyfile" className="px-3 py-2">
              Caddyfile
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="certificates" className="px-3 py-2">
            Certificates
          </TabsTrigger>
          <TabsTrigger value="logs" className="px-3 py-2">
            Access logs
          </TabsTrigger>
          <TabsTrigger value="caddy" className="px-3 py-2">
            Events
          </TabsTrigger>
          {isInstallAdmin ? (
            <TabsTrigger value="firewall" className="px-3 py-2">
              Firewall
            </TabsTrigger>
          ) : null}
        </TabsList>
        {tab === "caddyfile" ? <CaddyfileActions /> : null}
        {tab === "certificates" ? (
          <CertificatesActions onUploadCert={() => setUploadCertOpen(true)} />
        ) : null}
      </div>

      {/* Not just hidden — unmounted, so `useCaddyfileQuery` never runs for a
          viewer who would only get a 403 out of it. */}
      {isInstallAdmin ? (
        <TabsContent value="caddyfile" className="min-h-0 flex-1 overflow-y-auto p-4">
          <CaddyfileTab orgSlug={orgSlug} />
        </TabsContent>
      ) : null}

      <TabsContent value="certificates" className="min-h-0 flex-1 overflow-y-auto p-4">
        <CertificatesTab
          orgSlug={orgSlug}
          onUploadCert={() => setUploadCertOpen(true)}
          onUploadCa={() => setUploadCaOpen(true)}
        />
      </TabsContent>

      <TabsContent value="logs" className="min-h-0 flex-1">
        <EdgeLogsView />
      </TabsContent>
      <TabsContent value="caddy" className="min-h-0 flex-1">
        <EdgeEventsView />
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
