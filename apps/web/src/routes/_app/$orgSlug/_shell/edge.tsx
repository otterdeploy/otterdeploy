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
 * Gated on `platform:read` for the Caddyfile/Certificates planes, so plain
 * members get an honest permission notice instead of install-wide config.
 */
import { useState } from "react";

import {
  ArrowRight01Icon,
  EarthIcon,
  RefreshIcon,
  UploadCircle01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import * as z from "zod";

import { TrustedCasTable } from "@/features/certificates/cas-table";
import { CustomCertsTable } from "@/features/certificates/custom-table";
import { ManagedCertsTable } from "@/features/certificates/managed-table";
import { CertificateStats } from "@/features/certificates/stats";
import { UploadCaDialog } from "@/features/certificates/upload-ca-dialog";
import { UploadCertDialog } from "@/features/certificates/upload-cert-dialog";
import { EdgeEventsView } from "@/features/edge-logs/components/edge-events-view";
import { EdgeLogsView } from "@/features/edge-logs/components/edge-logs-view";
import { FirewallView } from "@/features/firewall/components/firewall-view";
import { CaddyfileViewer } from "@/features/projects/components/networking/caddyfile-viewer";
import { useMembers } from "@/features/team/data/use-team";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

const EDGE_TABS = ["caddyfile", "certificates", "logs", "caddy", "firewall"] as const;
type EdgeTab = (typeof EDGE_TABS)[number];

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
  loader: () => {
    void queryClient
      .prefetchQuery(orpc.system.caddyfile.queryOptions())
      .catch(() => undefined);
    void queryClient.prefetchQuery(orpc.certificates.inventory.queryOptions()).catch(() => undefined);
    void queryClient.prefetchQuery(orpc.certificates.listCustom.queryOptions()).catch(() => undefined);
    void queryClient.prefetchQuery(orpc.certificates.listCas.queryOptions()).catch(() => undefined);
  },
});

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  const { tab } = Route.useSearch();
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
          <TabsTrigger value="caddyfile" className="px-3 py-2">
            Caddyfile
          </TabsTrigger>
          <TabsTrigger value="certificates" className="px-3 py-2">
            Certificates
          </TabsTrigger>
          <TabsTrigger value="logs" className="px-3 py-2">
            Access logs
          </TabsTrigger>
          <TabsTrigger value="caddy" className="px-3 py-2">
            Events
          </TabsTrigger>
          <TabsTrigger value="firewall" className="px-3 py-2">
            Firewall
          </TabsTrigger>
        </TabsList>
        {tab === "caddyfile" ? <CaddyfileActions /> : null}
        {tab === "certificates" ? (
          <CertificatesActions onUploadCert={() => setUploadCertOpen(true)} />
        ) : null}
      </div>

      <TabsContent value="caddyfile" className="min-h-0 flex-1 overflow-y-auto p-4">
        <CaddyfileTab orgSlug={orgSlug} />
      </TabsContent>

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
      <TabsContent value="firewall" className="min-h-0 flex-1">
        <FirewallView />
      </TabsContent>

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

// ─── Certificates plane (formerly Settings → Workspace → Certificates) ──
//
//   - Managed  — every enabled public domain across the org's projects with
//     the cert the Caddy edge ACTUALLY serves (live TLS probe — ground
//     truth, never cached). "Recheck all" re-probes.
//   - Custom   — uploaded PEM chain + key, validated server-side, installed
//     through the same reconcile pass routes use.
//   - Trusted CAs — PEM inventory (view/download/remove).
//
// No "Renew" button: Caddy auto-renews ACME certs and exposes no
// force-renew via its admin API — a renew action would be fake.

function recheckCertificates() {
  void queryClient.invalidateQueries({ queryKey: orpc.certificates.inventory.queryKey() });
  void queryClient.invalidateQueries({ queryKey: orpc.certificates.listCustom.queryKey() });
}

function useCanManageCertificates() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { user } = Route.useRouteContext();
  const members = useMembers(organization.id);
  const myRole = members.data?.find((m) => m.userId === user.id)?.role;
  return myRole === "owner" || myRole === "admin";
}

function CertificatesActions({ onUploadCert }: { onUploadCert: () => void }) {
  const inventory = useQuery(orpc.certificates.inventory.queryOptions());
  const canManage = useCanManageCertificates();

  return (
    <div className="flex items-center gap-2">
      {inventory.data ? (
        <span className="hidden font-mono text-[11px] text-muted-foreground/70 sm:inline">
          via {inventory.data.edgeHost} · {new Date(inventory.data.probedAt).toLocaleTimeString()}
        </span>
      ) : null}
      <Button size="sm" variant="outline" disabled={inventory.isFetching} onClick={recheckCertificates}>
        <HugeiconsIcon
          icon={RefreshIcon}
          strokeWidth={2}
          className={cn(inventory.isFetching && "animate-spin")}
        />
        Recheck all
      </Button>
      {canManage ? (
        <Button size="sm" onClick={onUploadCert}>
          <HugeiconsIcon icon={UploadCircle01Icon} strokeWidth={2} />
          Upload custom
        </Button>
      ) : null}
    </div>
  );
}

function CertificatesTab({
  orgSlug,
  onUploadCert,
  onUploadCa,
}: {
  orgSlug: string;
  onUploadCert: () => void;
  onUploadCa: () => void;
}) {
  const canManage = useCanManageCertificates();

  const inventory = useQuery(orpc.certificates.inventory.queryOptions());
  const customs = useQuery(orpc.certificates.listCustom.queryOptions());
  const cas = useQuery(orpc.certificates.listCas.queryOptions());

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        TLS at the Caddy edge — what each public domain actually serves, probed live. ACME
        certificates renew automatically; custom uploads are rotated by you.
      </p>

      <CertificateStats inventory={inventory.data} customs={customs.data} />

      {inventory.isError ? (
        <ErrorState
          title="Couldn't probe the edge"
          message={inventory.error.message}
          onRetry={() => void inventory.refetch()}
        />
      ) : (
        <Tabs defaultValue="managed">
          <TabsList>
            <TabsTrigger value="managed">
              Managed{inventory.data ? ` · ${inventory.data.certificates.length}` : ""}
            </TabsTrigger>
            <TabsTrigger value="custom">
              Custom{customs.data ? ` · ${customs.data.length}` : ""}
            </TabsTrigger>
            <TabsTrigger value="cas">
              Trusted CAs{cas.data ? ` · ${cas.data.length}` : ""}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="managed" className="mt-3">
            <ManagedCertsTable
              inventory={inventory.data}
              isLoading={inventory.isLoading}
              orgSlug={orgSlug}
            />
          </TabsContent>

          <TabsContent value="custom" className="mt-3">
            <CustomCertsTable
              customs={customs.data}
              inventory={inventory.data}
              isLoading={customs.isLoading}
              canManage={canManage}
              onUpload={onUploadCert}
            />
          </TabsContent>

          <TabsContent value="cas" className="mt-3">
            <div className="flex flex-col gap-3">
              {canManage && cas.data && cas.data.length > 0 ? (
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={onUploadCa}>
                    <HugeiconsIcon icon={UploadCircle01Icon} strokeWidth={2} />
                    Upload CA
                  </Button>
                </div>
              ) : null}
              <TrustedCasTable
                cas={cas.data}
                isLoading={cas.isLoading}
                canManage={canManage}
                onUpload={onUploadCa}
              />
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
