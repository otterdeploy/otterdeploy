import { useEffect, useState } from "react";

import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { toast } from "sonner";

import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { ConnectDialog } from "@/features/git-providers/connect-dialog";
import { gitProvidersCollection } from "@/features/git-providers/data/git-providers";
import {
  ConnectedProviderCard,
  DisconnectedProviderCard,
} from "@/features/git-providers/provider-card";
import { type ProviderKind } from "@/features/git-providers/shared";
import { orpc, queryClient } from "@/shared/server/orpc";

export const Route = createFileRoute("/_app/$orgSlug/git-providers")({
  staticData: { crumb: "Git providers" },
  validateSearch: (search: Record<string, unknown>) => ({
    git_install: search.git_install as "ok" | "error" | undefined,
    reason: search.reason as string | undefined,
  }),
  component: GitProvidersRoute,
});

function GitProvidersRoute() {
  useInstallCallbackToast();

  const { data: providers } = useLiveQuery((q) =>
    q.from({ p: gitProvidersCollection }),
  );
  const [open, setOpen] = useState(false);

  const allKinds: ProviderKind[] = ["github", "gitlab", "gitea", "bitbucket"];
  const byKind = new Map<ProviderKind, (typeof providers)[number]>(
    providers.map((p) => [p.kind, p]),
  );

  return (
    <Page width="narrow">
      <PageHeader
        title="Git providers"
        description="Source control connections used to deploy services on push."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            Connect provider
          </Button>
        }
      />

      <div className="flex flex-col gap-3">
        {allKinds.map((kind) => {
          const provider = byKind.get(kind);
          if (provider && provider.installations.length > 0) {
            return <ConnectedProviderCard key={provider.id} provider={provider} />;
          }
          return (
            <DisconnectedProviderCard
              key={kind}
              kind={kind}
              onConnect={() => setOpen(true)}
            />
          );
        })}
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Connections install a GitHub App on your account or organization.
        Pushes to a project's production branch trigger an automatic deploy.
      </p>

      <ConnectDialog open={open} onOpenChange={setOpen} />
    </Page>
  );
}

/**
 * Reads ?git_install=ok|error from the install callback redirect, surfaces
 * a toast, then strips the params from the URL so a refresh doesn't re-fire.
 */
function useInstallCallbackToast() {
  const search = useSearch({ from: "/_app/$orgSlug/git-providers" });

  useEffect(() => {
    if (search.git_install === "ok") {
      toast.success("GitHub connected");
      void queryClient.invalidateQueries({
        queryKey: orpc.git.list.queryKey({ input: undefined }),
      });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (search.git_install === "error") {
      const reason = search.reason ?? "unknown";
      toast.error(`GitHub install failed: ${reason}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [search.git_install, search.reason]);
}
