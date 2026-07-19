/**
 * Org-wide certificates page. Three planes:
 *
 *   - Managed  — every enabled public domain across the org's projects with
 *     the cert the Caddy edge ACTUALLY serves (live TLS probe — ground
 *     truth, never cached). "Recheck all" re-probes.
 *   - Custom   — uploaded PEM chain + key, validated server-side, installed
 *     through the same reconcile pass routes use; status reflects the real
 *     outcome (serving / installed / stored / failed — never assumed).
 *   - Trusted CAs — PEM inventory (view/download/remove). Honest scope: the
 *     generated edge config doesn't consume a CA pool today.
 *
 * There is deliberately no "Renew" button: Caddy auto-renews ACME certs and
 * exposes no force-renew via its admin API — a renew action would be fake.
 */

import { useState } from "react";

import { RefreshIcon, UploadCircle01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";

import { TrustedCasTable } from "@/features/certificates/cas-table";
import { CustomCertsTable } from "@/features/certificates/custom-table";
import { ManagedCertsTable } from "@/features/certificates/managed-table";
import { CertificateStats } from "@/features/certificates/stats";
import { UploadCaDialog } from "@/features/certificates/upload-ca-dialog";
import { UploadCertDialog } from "@/features/certificates/upload-cert-dialog";
import { useMembers } from "@/features/team/data/use-team";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { ErrorState } from "@/shared/components/ui/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/certificates")({
  staticData: { crumb: "Certificates" },
  component: RouteComponent,
});

function recheck() {
  void queryClient.invalidateQueries({ queryKey: orpc.certificates.inventory.queryKey() });
  void queryClient.invalidateQueries({ queryKey: orpc.certificates.listCustom.queryKey() });
}

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { orgSlug } = Route.useParams();
  const { user } = Route.useRouteContext();

  const members = useMembers(organization.id);
  const myRole = members.data?.find((m) => m.userId === user.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  const inventory = useQuery(orpc.certificates.inventory.queryOptions());
  const customs = useQuery(orpc.certificates.listCustom.queryOptions());
  const cas = useQuery(orpc.certificates.listCas.queryOptions());

  const [uploadCertOpen, setUploadCertOpen] = useState(false);
  const [uploadCaOpen, setUploadCaOpen] = useState(false);

  return (
    <Page>
      <PageHeader
        title="Certificates"
        description="TLS at the Caddy edge — what each public domain actually serves, probed live. ACME certificates renew automatically; custom uploads are rotated by you."
        actions={
          <div className="flex items-center gap-2">
            {inventory.data ? (
              <span className="hidden font-mono text-[11px] text-muted-foreground/70 sm:inline">
                via {inventory.data.edgeHost} ·{" "}
                {new Date(inventory.data.probedAt).toLocaleTimeString()}
              </span>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={inventory.isFetching}
              onClick={recheck}
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                strokeWidth={2}
                className={cn(inventory.isFetching && "animate-spin")}
              />
              Recheck all
            </Button>
            {canManage ? (
              <Button size="sm" onClick={() => setUploadCertOpen(true)}>
                <HugeiconsIcon icon={UploadCircle01Icon} strokeWidth={2} />
                Upload custom
              </Button>
            ) : null}
          </div>
        }
      />

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
              onUpload={() => setUploadCertOpen(true)}
            />
          </TabsContent>

          <TabsContent value="cas" className="mt-3">
            <div className="flex flex-col gap-3">
              {canManage && cas.data && cas.data.length > 0 ? (
                <div className="flex justify-end">
                  <Button size="sm" variant="outline" onClick={() => setUploadCaOpen(true)}>
                    <HugeiconsIcon icon={UploadCircle01Icon} strokeWidth={2} />
                    Upload CA
                  </Button>
                </div>
              ) : null}
              <TrustedCasTable
                cas={cas.data}
                isLoading={cas.isLoading}
                canManage={canManage}
                onUpload={() => setUploadCaOpen(true)}
              />
            </div>
          </TabsContent>
        </Tabs>
      )}

      <UploadCertDialog open={uploadCertOpen} onOpenChange={setUploadCertOpen} />
      <UploadCaDialog open={uploadCaOpen} onOpenChange={setUploadCaOpen} />
    </Page>
  );
}
