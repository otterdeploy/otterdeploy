/**
 * The SSH keys page body: one hairline ledger of keys (rows, not cards, so a
 * single key doesn't float in half the width and eight still fit a screen),
 * a one-line count above it, the empty state, and an honest "Coming soon"
 * for git deploy keys, which this page can't make yet.
 */

import { useState } from "react";

import {
  GitBranchIcon,
  Key01Icon,
  PlusSignIcon,
  UploadCircle01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";

import { Page, PageHeader } from "@/shared/components/page";
import { Badge } from "@/shared/components/ui/badge";
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

import { useKeyServers } from "./data/use-key-servers";
import { GenerateKeyDialog } from "./generate-dialog";
import { ImportKeyDialog } from "./import-dialog";
import { KeyRow, LEDGER_COLUMNS } from "./key-row";

export function SshKeysPage({ canManage }: { canManage: boolean }) {
  const { data: keys, isLoading } = useQuery(orpc.sshKeys.list.queryOptions());
  const serversOf = useKeyServers();
  const [generateOpen, setGenerateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const hasKeys = !!keys && keys.length > 0;
  const inUse = keys?.filter((k) => k.usedBy.length > 0).length ?? 0;

  return (
    <Page>
      <PageHeader
        title="SSH keys"
        description="Keys otterdeploy uses to sign in to your servers. Private keys are encrypted at rest; only the public half is ever shown."
        actions={
          canManage && hasKeys ? (
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
        <LedgerSkeleton />
      ) : !hasKeys ? (
        <Empty className="flex-none rounded-lg border border-dashed bg-muted/30 py-12">
          <EmptyHeader>
            <HugeiconsIcon
              icon={Key01Icon}
              strokeWidth={1.5}
              className="size-10 text-muted-foreground/60"
            />
            <EmptyTitle>No SSH keys yet</EmptyTitle>
            <EmptyDescription>
              otterdeploy signs in to your servers over SSH with a key from here. Generate one, add
              its public key to a server's <code className="font-mono">authorized_keys</code>, then
              pick it when you add the server.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {canManage ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                  Import a public key
                </Button>
                <Button size="sm" onClick={() => setGenerateOpen(true)}>
                  Generate a key
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Only owners and admins can add keys.</p>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2.5">
          {keys.length > 1 ? (
            <p className="flex gap-3.5 text-[12.5px] text-muted-foreground">
              <span>
                <span className="font-medium text-foreground tabular-nums">{keys.length}</span> keys
              </span>
              <span>
                <span className="font-medium text-foreground tabular-nums">{inUse}</span> in use
              </span>
              <span>
                <span className="font-medium text-foreground tabular-nums">
                  {keys.length - inUse}
                </span>{" "}
                unused
              </span>
            </p>
          ) : null}
          <div className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
            <div
              aria-hidden
              className={`hidden h-[34px] items-center gap-x-4 border-b px-4 text-xs text-muted-foreground xl:grid ${LEDGER_COLUMNS}`}
            >
              <span>Key</span>
              <span>Used by</span>
              <span>Activity</span>
              <span />
            </div>
            <ul className="divide-y divide-border">
              {keys.map((k) => (
                <KeyRow key={k.id} sshKey={k} servers={serversOf(k.usedBy)} canManage={canManage} />
              ))}
            </ul>
          </div>
        </div>
      )}

      <GitDeployKeysSoon />

      <GenerateKeyDialog open={generateOpen} onOpenChange={setGenerateOpen} />
      <ImportKeyDialog open={importOpen} onOpenChange={setImportOpen} />
    </Page>
  );
}

/** Git clones over SSH aren't supported (git/contract.ts rejects SSH clone
 *  URLs), so there are no deploy keys to list. Say so instead of implying
 *  these keys do it. */
function GitDeployKeysSoon() {
  const { orgSlug } = useParams({ from: "/_app/$orgSlug" });
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-muted-foreground">
      <Badge variant="secondary">Coming soon</Badge>
      <span>
        <span className="font-medium text-foreground">Git deploy keys.</span> Cloning over SSH isn't
        supported yet; private GitHub repositories already clone through the GitHub connection.
      </span>
      <Button
        variant="outline"
        size="xs"
        render={<Link to="/$orgSlug/git-providers" params={{ orgSlug }} />}
      >
        <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} />
        Git providers
      </Button>
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b px-4 py-3.5 last:border-b-0">
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-6 w-24" />
        </div>
      ))}
    </div>
  );
}
