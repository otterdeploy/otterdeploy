// Deploy-hooks editor for a git-sourced service. Two ordered lists of shell
// commands — preDeploy + postDeploy — staged onto the manifest service entry
// (same manifest.get → patch → manifest.save path as the build card), so the
// change rides the pending-changes bar and takes effect on the next Deploy.
//
// The builder runs each command in a throwaway container off the freshly built
// image (`sh -c "<command>"`): preDeploy AFTER the build but BEFORE the rollout
// (a non-zero exit aborts the deploy — the slot for db migrations); postDeploy
// AFTER the new replicas are live + healthy (best-effort — a failure is logged
// but doesn't roll back).

import type { ProjectId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { useStageManifestChange } from "@/features/projects/hooks/use-manifest-stage";
import { SettingsCard } from "@/features/resources/components/_shared/settings-card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { orpc } from "@/shared/server/orpc";

interface CmdRow {
  /** Stable identity for React keys — rows are added/removed by position. */
  id: string;
  value: string;
}

let cmdSeq = 0;
const newCmdRow = (value = ""): CmdRow => ({ id: `cmd-${cmdSeq++}`, value });

/** Editor rows → the `string[]` the manifest stores. Blank rows are dropped. */
const toCommands = (rows: CmdRow[]): string[] =>
  rows.flatMap((r) => {
    const v = r.value.trim();
    return v ? [v] : [];
  });

/**
 * Reads the service's current hooks from the manifest and renders the editor.
 * Keyed by manifest version so a successful save (which bumps the version +
 * invalidates the query) cleanly re-seeds the editor and resets the dirty flag.
 */
export function ServiceDeployHooksCard({
  projectId,
  serviceName,
}: {
  projectId: string;
  serviceName: string;
}) {
  const manifest = useQuery(
    orpc.project.manifest.get.queryOptions({
      input: { id: projectId as ProjectId },
    }),
  );

  if (manifest.isLoading) {
    return (
      <SettingsCard title="Deploy hooks" description="Shell commands run around each deploy.">
        <div className="px-3 py-3 text-[12.5px] text-muted-foreground">Loading…</div>
      </SettingsCard>
    );
  }

  const svc = manifest.data?.manifest?.services?.[serviceName];
  // Hooks run off the built image, so they only apply to git-sourced services.
  // (The parent already gates on this; the guard keeps the card self-contained.)
  if (!svc || svc.source !== "git") return null;

  const pre = "preDeploy" in svc && Array.isArray(svc.preDeploy) ? svc.preDeploy : [];
  const post = "postDeploy" in svc && Array.isArray(svc.postDeploy) ? svc.postDeploy : [];

  return (
    <DeployHooksEditor
      key={manifest.data?.version ?? 0}
      projectId={projectId}
      serviceName={serviceName}
      initialPre={pre}
      initialPost={post}
    />
  );
}

function DeployHooksEditor({
  projectId,
  serviceName,
  initialPre,
  initialPost,
}: {
  projectId: string;
  serviceName: string;
  initialPre: string[];
  initialPost: string[];
}) {
  const [preRows, setPreRows] = useState<CmdRow[]>(() => initialPre.map(newCmdRow));
  const [postRows, setPostRows] = useState<CmdRow[]>(() => initialPost.map(newCmdRow));

  const stage = useStageManifestChange(projectId as ProjectId, {
    successToast: "Deploy hooks saved — deploy to apply",
  });

  const save = () =>
    stage.mutate((m) => {
      const svc = m.services[serviceName];
      if (!svc || svc.source !== "git") return m;
      const pre = toCommands(preRows);
      const post = toCommands(postRows);
      return {
        ...m,
        services: {
          ...m.services,
          [serviceName]: {
            ...svc,
            preDeploy: pre.length > 0 ? pre : null,
            postDeploy: post.length > 0 ? post : null,
          },
        },
      };
    });

  const dirty =
    JSON.stringify(toCommands(preRows)) !== JSON.stringify(initialPre) ||
    JSON.stringify(toCommands(postRows)) !== JSON.stringify(initialPost);

  const busy = stage.isPending;

  return (
    <SettingsCard
      title="Deploy hooks"
      description="Shell commands run in a throwaway container off the new image. Saved changes apply on the next Deploy."
    >
      <HookList
        label="Pre-deploy"
        hint="Run after the build, before traffic shifts — a non-zero exit aborts the deploy (the slot for db migrations)."
        rows={preRows}
        setRows={setPreRows}
        busy={busy}
        addLabel="Add pre-deploy command"
      />
      <HookList
        label="Post-deploy"
        hint="Run after the new replicas are live + healthy — best-effort; a failure won't roll back (cache warmup, smoke checks)."
        rows={postRows}
        setRows={setPostRows}
        busy={busy}
        addLabel="Add post-deploy command"
      />
      <div className="flex justify-end px-3 py-2.5">
        <Button type="button" size="sm" disabled={!dirty || busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </SettingsCard>
  );
}

function HookList({
  label,
  hint,
  rows,
  setRows,
  busy,
  addLabel,
}: {
  label: string;
  hint: string;
  rows: CmdRow[];
  setRows: React.Dispatch<React.SetStateAction<CmdRow[]>>;
  busy: boolean;
  addLabel: string;
}) {
  const setRow = (i: number, value: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, value } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const addRow = () => setRows((rs) => [...rs, newCmdRow()]);

  return (
    <div className="flex flex-col gap-2 border-b border-border/40 px-3 py-2.5">
      <div className="flex flex-col">
        <span className="text-[12px] text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>

      {rows.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {rows.map((row, i) => (
            <div key={row.id} className="flex items-center gap-1.5">
              <Input
                value={row.value}
                onChange={(e) => setRow(i, e.target.value)}
                placeholder="e.g. bun run db:migrate"
                className="h-8 flex-1 font-mono text-[12.5px]"
                disabled={busy}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-muted-foreground"
                disabled={busy}
                onClick={() => removeRow(i)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7"
          disabled={busy}
          onClick={addRow}
        >
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
