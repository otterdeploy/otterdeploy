/**
 * Org-scoped API keys management page. Lists the workspace's keys with their
 * masked prefix, scopes, usage and expiry, and (for owners/admins) lets you
 * create, enable/disable and delete them. The plaintext token is only ever seen
 * once, via the RevealKeyDialog opened right after creation.
 */

import { useState } from "react";
import { Key02Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { eq, useLiveQuery } from "@tanstack/react-db";

import { ApiKeyRow } from "@/features/api-keys/api-key-row";
import { CreateKeyDialog } from "@/features/api-keys/create-key-dialog";
import { apiKeysCollection } from "@/features/api-keys/data/api-keys";
import { RevealKeyDialog } from "@/features/api-keys/reveal-key-dialog";
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
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

export const Route = createFileRoute("/_app/$orgSlug/api-keys")({
  staticData: { crumb: "API keys" },
  component: RouteComponent,
});

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { user } = Route.useRouteContext();
  const organizationId = organization.id;

  // Reuse the cached members query to resolve the viewer's role — only
  // owners/admins can create, toggle or delete the workspace's keys.
  const members = useMembers(organizationId);
  const myRole = members.data?.find((m) => m.userId === user.id)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  // Shared collection scoped to the viewed org — the `eq` filter forwards as a
  // subset load, so this both fetches and subscribes. `isLoading` is true only
  // on the first fetch of this org's subset.
  const { data: keys, isLoading } = useLiveQuery(
    (q) =>
      q
        .from({ k: apiKeysCollection })
        .where(({ k }) => eq(k.organizationId, organizationId)),
    [organizationId],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [revealKey, setRevealKey] = useState<string | null>(null);

  return (
    <Page>
      <PageHeader
        title="API keys"
        description={
          <>
            Programmatic access to{" "}
            <span className="font-medium text-foreground/80">
              {organization.name}
            </span>{" "}
            for the CLI, CI pipelines and scripts. Keys are shared across the
            workspace.
          </>
        }
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
              Create key
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <div className="rounded-md border bg-card p-6 text-center text-[12.5px] text-muted-foreground">
          Loading…
        </div>
      ) : keys.length === 0 ? (
        <Empty className="flex-1 rounded-md border border-dashed bg-muted/20 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Key02Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/50"
            />
            <EmptyTitle>No API keys yet</EmptyTitle>
            <EmptyDescription>
              Create a key to authenticate the CLI or automate deploys from CI.
            </EmptyDescription>
          </EmptyHeader>
          {canManage ? (
            <EmptyContent>
              <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
                Create your first key
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Enabled</TableHead>
                {canManage ? <TableHead className="w-10" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <ApiKeyRow key={k.id} apiKey={k} canManage={canManage} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateKeyDialog
        organizationId={organizationId}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={setRevealKey}
      />
      <RevealKeyDialog apiKey={revealKey} onClose={() => setRevealKey(null)} />
    </Page>
  );
}
