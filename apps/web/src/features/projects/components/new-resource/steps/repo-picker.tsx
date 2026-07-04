import { useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/components/ui/combobox";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Spinner } from "@/shared/components/ui/spinner";
import { orpc } from "@/shared/server/orpc";

export interface RepoOwner {
  id: string;
  accountLogin: string;
  accountType: "user" | "organization";
}

/** owner/name → name (owner is chosen separately, so the list stays short). */
const repoName = (fullName: string) => fullName.slice(fullName.indexOf("/") + 1);

/**
 * Deploy-wizard repo picker: an owner dropdown (one per connected GitHub App
 * installation) + a searchable repository combobox scoped to that owner.
 * Binds the chosen repo to the project (`project.update`) and hands the
 * gitRepoId back to the form via `onBound` — no detour to Settings.
 */
export function RepoPicker({
  installations,
  projectId,
  onBound,
}: {
  installations: RepoOwner[];
  projectId: string | null;
  onBound: (repoId: string, fullName: string) => void;
}) {
  const [owner, setOwner] = useState(installations[0]?.id ?? "");
  const [selected, setSelected] = useState("");

  const reposQuery = useQuery(
    orpc.git.listRepos.queryOptions({
      input: { installationId: (owner || "") as never },
      enabled: Boolean(owner),
    }),
  );
  const repos = reposQuery.data ?? [];

  if (!projectId || installations.length === 0) return null;

  function bind(name: string) {
    const repo = repos.find((r) => repoName(r.fullName) === name);
    if (!repo || !projectId) return;
    setSelected(name);
    // Repo binds to the SERVICE now (via onBound → service create), not the
    // project — no project.update here.
    onBound(repo.id, repo.fullName);
    toast.success(`Bound to ${repo.fullName}`);
  }

  const names = repos.map((r) => repoName(r.fullName));

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,11rem)_1fr]">
      {installations.length > 1 ? (
        <div className="flex flex-col gap-1.5">
          <Label className="text-[12px]">Owner</Label>
          <Select
            value={owner}
            onValueChange={(v) => {
              if (v) {
                setOwner(v);
                setSelected("");
              }
            }}
            items={installations.map((i) => ({ label: i.accountLogin, value: i.id }))}
          >
            <SelectTrigger className="h-8 text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {installations.map((i) => (
                <SelectItem key={i.id} value={i.id} className="text-[12px]">
                  {i.accountLogin}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      <div className={installations.length > 1 ? "flex flex-col gap-1.5" : "flex flex-col gap-1.5 sm:col-span-2"}>
        <Label className="text-[12px]">Repository</Label>
        {reposQuery.isLoading ? (
          <div className="flex h-8 items-center gap-2 rounded-md border bg-muted/20 px-3 text-[12px] text-muted-foreground">
            <Spinner className="size-3.5" />
            Loading repositories…
          </div>
        ) : names.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">
            No repositories synced for this owner yet — open the GitHub App, hit{" "}
            <span className="font-medium">Sync now</span> (or Reinstall), then come back.
          </p>
        ) : (
          <Combobox items={names} value={selected} onValueChange={(v) => v && bind(v)}>
            <ComboboxInput
              placeholder="Search repositories…"
              className="h-8 font-mono text-[12.5px]"
            />
            <ComboboxContent>
              <ComboboxEmpty>No matching repositories.</ComboboxEmpty>
              <ComboboxList>
                {(name: string) => (
                  <ComboboxItem key={name} value={name} className="font-mono text-[12.5px]">
                    {name}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        )}
      </div>
    </div>
  );
}
