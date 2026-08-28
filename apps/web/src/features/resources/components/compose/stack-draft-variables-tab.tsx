/**
 * Stack variables BEFORE the first deploy.
 *
 * `StackVariablesTab` reads env off the stack's materialized children, so it
 * has nothing to show until the stack has deployed at least once — it says as
 * much ("Variables appear once the stack deploys"). That left a staged stack
 * with no way to set the values it is about to deploy with: a template
 * declaring `${AUTHENTIK_URL}` went out with the variable unset, and the tab
 * that would have fixed it was disabled for being a draft.
 *
 * This is the draft half. The rows come from the `${VAR}` refs the staged
 * compose file actually declares (`compose.parse`), and edits are written back
 * to `manifest.composes[<stack>].env`, so the value is already in the manifest
 * when the pending-changes bar applies it.
 */
import { useState } from "react";

import { idSchema } from "@otterdeploy/shared/id";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { orpc } from "@/shared/server/orpc";

import type { DraftVar } from "./stack-draft-vars";

import { buildRows } from "./stack-draft-vars";

export function StackDraftVariablesTab({
  projectId,
  stackName,
  composeContent,
  stageEnv,
}: {
  /** Plain string off the panel's resource shape; branded below, at the one
   *  place it crosses into the id-typed manifest APIs. */
  projectId: string;
  /** Manifest key for this stack: the map entry the save writes back into. */
  stackName: string;
  /** Staged compose YAML, or null for a git stack with nothing cloned yet. */
  composeContent: string | null;
  stageEnv: Record<string, string>;
}) {
  const stage = useStageManifestChange(idSchema.project.parse(projectId));
  // Local edits, keyed by var name. Absent = not touched, fall back to staged.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const preview = useQuery({
    ...orpc.compose.parse.queryOptions({
      input: { projectId, content: composeContent ?? "" },
    }),
    enabled: composeContent !== null && composeContent.length > 0,
  });

  if (composeContent === null) {
    return (
      <p className="text-[12px] text-muted-foreground">
        This stack builds from a repo. Its variables are read from the compose file once the repo is
        cloned on the first deploy.
      </p>
    );
  }
  if (preview.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  const rows = buildRows(preview.data?.vars ?? [], stageEnv);
  if (rows.length === 0) {
    return (
      <p className="text-[12px] text-muted-foreground">
        This stack&rsquo;s compose file declares no variables.
      </p>
    );
  }

  const valueOf = (row: DraftVar) => edits[row.name] ?? row.value;
  const dirty = Object.entries(edits).some(
    ([name, value]) => value !== (rows.find((r) => r.name === name)?.value ?? ""),
  );

  const save = () => {
    setSaving(true);
    const next: Record<string, string> = {};
    for (const row of rows) {
      const value = valueOf(row);
      // An empty value is an absent value, not an empty string: leaving the
      // key out lets the compose file's own `${VAR:-default}` apply instead of
      // overriding it with "".
      if (value !== "") next[row.name] = value;
    }
    void stage
      .mutateAsync((current) => {
        const spec = current.composes[stackName];
        if (!spec) return current;
        return {
          ...current,
          composes: { ...current.composes, [stackName]: { ...spec, env: next } },
        };
      })
      .then(() => {
        toast.success("Variables staged", {
          description: "They apply when you deploy this stack.",
        });
        setEdits({});
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Failed to stage variables"),
      )
      .finally(() => setSaving(false));
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-muted-foreground">
        Set these before you deploy. They are the <code className="font-mono">${"{VAR}"}</code> refs
        this stack&rsquo;s compose file declares.
      </p>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <label key={row.name} className="flex items-center gap-3">
            <span className="w-1/3 shrink-0 truncate font-mono text-[12px]" title={row.name}>
              {row.name}
            </span>
            <Input
              className="h-8 font-mono text-[12px]"
              value={valueOf(row)}
              placeholder={row.fallback ?? "not set"}
              onChange={(e) => setEdits((prev) => ({ ...prev, [row.name]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save variables"}
        </Button>
      </div>
    </div>
  );
}
