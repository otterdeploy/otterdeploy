/**
 * The Edge page's Certificates plane (formerly Settings → Workspace →
 * Certificates), split out of edge.tsx purely for size: edge.tsx hosts five
 * planes and this is the only one with its own permission check, its own
 * sub-tabs and its own header actions, so it's the cohesive piece to lift out.
 * Content is unchanged. The route still owns the tab chrome and the two upload
 * dialogs, and passes the "open upload" callbacks down.
 *
 *   - Managed: every enabled public domain across the org's projects with
 *     the cert the Caddy edge ACTUALLY serves (live TLS probe, ground
 *     truth, never cached). "Recheck all" re-probes.
 *   - Custom, uploaded PEM chain + key, validated server-side, installed
 *     through the same reconcile pass routes use.
 *   - Trusted CAs: PEM inventory (view/download/remove).
 *
 * No "Renew" button: Caddy auto-renews ACME certs and exposes no
 * force-renew via its admin API: a renew action would be fake.
 */

import { RefreshIcon, UploadCircle01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useLoaderData, useRouteContext } from "@tanstack/react-router";

import { TrustedCasTable } from "@/features/certificates/cas-table";
import { CustomCertsTable } from "@/features/certificates/custom-table";
import { ManagedCertsTable } from "@/features/certificates/managed-table";
import { CertificateStats } from "@/features/certificates/stats";
import { useMembers } from "@/features/team/data/use-team";
import { Button } from "@/shared/components/ui/button";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

function recheckCertificates() {
  void queryClient.invalidateQueries({ queryKey: orpc.certificates.inventory.queryKey() });
  void queryClient.invalidateQueries({ queryKey: orpc.certificates.listCustom.queryKey() });
}

function useCanManageCertificates() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { user } = useRouteContext({ from: "/_app/$orgSlug/_shell/edge" });
  const members = useMembers(organization.id);
  const myRole = members.data?.find((m) => m.userId === user.id)?.role;
  return myRole === "owner" || myRole === "admin";
}

export function CertificatesActions({ onUploadCert }: { onUploadCert: () => void }) {
  const inventory = useQuery(orpc.certificates.inventory.queryOptions());
  const canManage = useCanManageCertificates();

  return (
    <div className="flex items-center gap-2">
      {inventory.data ? (
        <span className="hidden font-mono text-[11px] text-muted-foreground/70 sm:inline">
          via {inventory.data.edgeHost} · {new Date(inventory.data.probedAt).toLocaleTimeString()}
        </span>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        disabled={inventory.isFetching}
        onClick={recheckCertificates}
      >
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

export function CertificatesTab({
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
        TLS at the Caddy edge: what each public domain actually serves, probed live. ACME
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
