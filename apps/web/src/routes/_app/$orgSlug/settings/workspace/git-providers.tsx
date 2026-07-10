import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "@tanstack/react-db";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { z } from "zod";

import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
import { ConnectDialog } from "@/features/git-providers/connect-dialog";
import { gitProvidersCollection } from "@/features/git-providers/data/git-providers";
import {
  ConnectedProviderCard,
  DisconnectedProviderCard,
} from "@/features/git-providers/provider-card";
import { type ProviderKind } from "@/features/git-providers/shared";

// Zod so the fields infer as optional — otherwise `navigate({ to: this route })`
// would require a `search` object at every call site.
const searchSchema = z.object({
  git_install: z.enum(["ok", "error"]).optional().catch(undefined),
  reason: z.string().optional(),
  // App-relative path to land on after the GitHub round-trip — set by pages
  // that send the operator here mid-task (e.g. the deploy wizard).
  returnTo: z.string().startsWith("/").optional().catch(undefined),
});

export const Route = createFileRoute("/_app/$orgSlug/settings/workspace/git-providers")({
  staticData: { crumb: "Git providers" },
  validateSearch: searchSchema,
  component: GitProvidersRoute,
});

function GitProvidersRoute() {
  const { returnTo } = Route.useSearch();
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

      <ConnectDialog open={open} onOpenChange={setOpen} returnTo={returnTo} />
    </Page>
  );
}
