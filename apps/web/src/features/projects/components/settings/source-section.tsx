/**
 * Source binding — pick a git installation, a repo from it, and the
 * production branch that triggers deploys. Reuses the orpc.git.list +
 * orpc.git.listRepos endpoints already used by the git providers page.
 *
 * The installation that owns the currently-bound repo isn't known
 * directly (project.gitRepoId is just an id) — we keep the active
 * installation in local state and seed it from the first query that
 * returns the matching repo. When the user changes installations we
 * clear gitRepoId so we never persist a binding across installations.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/shared/components/ui/native-select";
import { orpc } from "@/shared/server/orpc";

interface SourceSectionProps {
  gitRepoId: string | null;
  productionBranch: string;
  onGitRepoIdChange: (v: string | null) => void;
  onProductionBranchChange: (v: string) => void;
}

export function SourceSection(props: SourceSectionProps) {
  const providersQuery = useQuery(
    orpc.git.list.queryOptions({ input: undefined }),
  );
  const providers = providersQuery.data ?? [];

  // Flatten provider → installations.
  const installations = providers.flatMap((p) =>
    p.installations.map((inst) => ({
      id: inst.id,
      label: `${p.kind}: ${inst.accountLogin}`,
    })),
  );

  const [activeInstallationId, setActiveInstallationId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (activeInstallationId) return;
    const first = installations[0];
    if (first) setActiveInstallationId(first.id);
  }, [activeInstallationId, installations]);

  const reposQuery = useQuery(
    orpc.git.listRepos.queryOptions({
      input: { installationId: (activeInstallationId ?? "") as never },
      enabled: activeInstallationId != null,
    }),
  );
  const repos = reposQuery.data ?? [];

  const onInstallationChange = (id: string) => {
    setActiveInstallationId(id || null);
    // Clear the selected repo on switch — keeping a stale repoId
    // would persist a binding across installations.
    props.onGitRepoIdChange(null);
  };

  return (
    <section className="rounded-md border bg-card p-5">
      <header className="mb-3">
        <h2 className="text-[14px] font-semibold">Source</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Pushes to the production branch of the linked repo trigger a deploy.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bind-install">Installation</Label>
          <NativeSelect
            id="bind-install"
            value={activeInstallationId ?? ""}
            onChange={(e) => onInstallationChange(e.target.value)}
            disabled={installations.length === 0}
          >
            <NativeSelectOption value="">
              {installations.length === 0
                ? "No git installations connected"
                : "Choose an installation"}
            </NativeSelectOption>
            {installations.map((row) => (
              <NativeSelectOption key={row.id} value={row.id}>
                {row.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bind-repo">Repository</Label>
          <NativeSelect
            id="bind-repo"
            value={props.gitRepoId ?? ""}
            onChange={(e) => props.onGitRepoIdChange(e.target.value || null)}
            disabled={repos.length === 0}
          >
            <NativeSelectOption value="">
              {activeInstallationId == null
                ? "Pick an installation first"
                : repos.length === 0
                  ? "No repos accessible"
                  : "Choose a repo"}
            </NativeSelectOption>
            {repos.map((r) => (
              <NativeSelectOption key={r.id} value={r.id}>
                {r.fullName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="bind-branch">Production branch</Label>
          <Input
            id="bind-branch"
            value={props.productionBranch}
            onChange={(e) => props.onProductionBranchChange(e.target.value)}
            placeholder="main"
            className="font-mono"
          />
        </div>
      </div>
    </section>
  );
}
