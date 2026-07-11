/**
 * Org-scoped SSH keys page. Lists the workspace's keys — generated (we hold the
 * encrypted private half) and imported (public-only) — and, for owners/admins,
 * lets you generate, import, rotate and delete them. Private key material is
 * never sent to the browser; cards only ever reveal the public half.
 */

import { useState } from "react";
import { Key01Icon, PlusSignIcon, UploadCircle01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { GenerateKeyDialog } from "@/features/ssh-keys/generate-dialog";
import { ImportKeyDialog } from "@/features/ssh-keys/import-dialog";
import { KeyCard } from "@/features/ssh-keys/key-card";
import { useMembers } from "@/features/team/data/use-team";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { orpc } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/ssh-keys")({
  staticData: { crumb: "SSH keys" },
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { user } = Route.useRouteContext();
  const organizationId = organization.id;

  const members = useMembers(organizationId);
  const myRole = members.data?.find((m) => m.userId === user.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  const { data: keys, isLoading } = useQuery(orpc.sshKeys.list.queryOptions());

  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <Page>
      <PageHeader
        title="SSH keys"
        description="Authenticate Git pulls and manage swarm nodes. Private keys are encrypted at rest — only the public half is ever shown."
        actions={
          canManage ? (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                <HugeiconsIcon icon={UploadCircle01Icon} strokeWidth={2} />
                Import
              </Button>
              <Button size="sm" onClick={() => setGenerateOpen(true)}>
                <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
                Generate
              </Button>
            </div>
          ) : null
        }
      />

      {isLoading ? (
        <div className="grid gap-3.5 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3 rounded-md border bg-card p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-md" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      ) : !keys || keys.length === 0 ? (
        <Empty className="flex-1 rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Key01Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No SSH keys yet</EmptyTitle>
            <EmptyDescription>
              Generate a key to authenticate Git pulls and manage nodes, or import
              an existing public key.
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8"
                  onClick={() => setImportOpen(true)}
                >
                  Import a key
                </Button>
                <Button size="sm" className="h-8" onClick={() => setGenerateOpen(true)}>
                  Generate a key
                </Button>
              </div>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="grid gap-3.5 md:grid-cols-2">
          {keys.map((k) => (
            <KeyCard key={k.id} sshKey={k} canManage={canManage} />
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Private keys are encrypted at rest with the cluster secret — only the
        public half is ever displayed.
      </p>

      <GenerateKeyDialog open={generateOpen} onOpenChange={setGenerateOpen} />
      <ImportKeyDialog open={importOpen} onOpenChange={setImportOpen} />
    </Page>
  );
}
