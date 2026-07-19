import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";
import { orpc } from "@/shared/server/orpc";

import { BulkEditSidebar } from "./variables-bulk-sidebar";
import { parseDotEnv, type ParsedVar } from "./variables-dotenv";
import type { EnvironmentRef, EnvVarRow } from "./variables-types";

/** One atomic bulkReplace per selected env — the calls are independent (each
 *  targets a distinct env) so they run concurrently; failures are collected so
 *  a partial failure reports exactly which envs missed. */
async function applyToTargets(
  targets: EnvironmentRef[],
  replaceEnv: (target: EnvironmentRef) => Promise<unknown>,
): Promise<{
  applied: EnvironmentRef[];
  failed: { env: EnvironmentRef; message: string }[];
}> {
  const applied: EnvironmentRef[] = [];
  const failed: { env: EnvironmentRef; message: string }[] = [];
  const results = await Promise.all(
    targets.map(async (target) => {
      try {
        await replaceEnv(target);
        return { target, message: null as string | null };
      } catch (err) {
        return {
          target,
          message: err instanceof Error ? err.message : "Couldn't save",
        };
      }
    }),
  );
  for (const { target, message } of results) {
    if (message === null) applied.push(target);
    else failed.push({ env: target, message });
  }
  return { applied, failed };
}

export function BulkEditDialog({
  projectId,
  env,
  allEnvs,
  currentRows,
  open,
  onOpenChange,
  onSaved,
  prefillText,
}: {
  projectId: string;
  env: EnvironmentRef;
  /** Every env in the project — the cross-env "Apply to" targets. */
  allEnvs: EnvironmentRef[];
  currentRows: EnvVarRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the env ids that were successfully replaced. */
  onSaved: (envIds: string[]) => void;
  /** When set (drag-drop .env import), seeds the editor instead of the current rows. */
  prefillText?: string | null;
}) {
  const initial = currentRows.map((v) => `${v.key}=${v.value}`).join("\n");
  const [text, setText] = useState(prefillText ?? initial);

  // Re-hydrate when the dialog opens or the rows refetch so a stale
  // edit doesn't persist between visits to the same env tab. A dropped
  // .env file (prefillText) wins over the current rows. Done in render
  // (prev-value compare) instead of an effect so the buffer is correct
  // on the first paint.
  const [prevInitial, setPrevInitial] = useState(initial);
  const [prevPrefill, setPrevPrefill] = useState(prefillText);
  if (initial !== prevInitial || prefillText !== prevPrefill) {
    setPrevInitial(initial);
    setPrevPrefill(prefillText);
    setText(prefillText ?? initial);
  }

  // Cross-env targets — the current env is pre-checked each time the
  // dialog opens; others are opt-in.
  const [targetIds, setTargetIds] = useState<Set<string>>(() => new Set([env.id]));
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevEnvId, setPrevEnvId] = useState(env.id);
  if (open !== prevOpen || env.id !== prevEnvId) {
    setPrevOpen(open);
    setPrevEnvId(env.id);
    if (open) setTargetIds(new Set([env.id]));
  }

  const toggleTarget = (envId: string) =>
    setTargetIds((s) => {
      const next = new Set(s);
      if (next.has(envId)) next.delete(envId);
      else next.add(envId);
      return next;
    });

  const parsed: ParsedVar[] = parseDotEnv(text);

  const targets = allEnvs.filter((e) => targetIds.has(e.id));
  const targetNames = targets.map((e) => e.name || e.slug).join(", ");

  const bulkMut = useMutation(orpc.project.envVar.bulkReplace.mutationOptions());
  const [saving, setSaving] = useState(false);

  const apply = async () => {
    if (targets.length === 0 || saving) return;
    setSaving(true);
    const { applied, failed } = await applyToTargets(targets, (target) =>
      bulkMut.mutateAsync({
        projectId,
        environmentId: target.id,
        vars: parsed.map((p) => ({
          key: p.key,
          value: p.value,
          isSecret: p.isSecret,
        })),
      }),
    );
    setSaving(false);
    if (applied.length > 0) onSaved(applied.map((e) => e.id));
    if (failed.length === 0) {
      onOpenChange(false);
      toast.success(`Saved ${parsed.length} variables to ${targetNames}`);
    } else {
      const failedNames = failed.map((f) => f.env.name || f.env.slug).join(", ");
      const appliedNames = applied.map((e) => e.name || e.slug).join(", ");
      toast.error(
        `Failed for ${failedNames}: ${failed[0].message}` +
          (applied.length > 0 ? ` — applied to ${appliedNames}` : ""),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl gap-0 p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-baseline gap-2 text-sm font-semibold">
            Bulk edit
            <span className="font-mono text-xs font-normal text-muted-foreground capitalize">
              · {env.name || env.slug}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              Paste a .env, or edit inline
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_280px] divide-x">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 border-b px-3 py-2 text-[11px]">
              <span className="text-muted-foreground">
                .env format · # comments ok · KEY=value
              </span>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                className="h-7"
                onClick={() =>
                  navigator.clipboard
                    ?.readText()
                    .then((t) => setText(t))
                    .catch(() => {})
                }
              >
                Paste from clipboard
              </Button>
            </div>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="min-h-[360px] resize-none rounded-none border-0 bg-muted/20 font-mono text-xs leading-7"
            />
          </div>

          <BulkEditSidebar
            allEnvs={allEnvs}
            targetIds={targetIds}
            onToggleTarget={toggleTarget}
            parsed={parsed}
          />
        </div>

        <div className="flex items-center gap-2 border-t px-4 py-3">
          <span className="text-[11px] text-muted-foreground">
            {targets.length === 0
              ? "Select at least one environment."
              : `Replaces every variable in ${targetNames} — atomic per environment.`}
          </span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={saving || targets.length === 0}
            onClick={() => void apply()}
          >
            {saving
              ? "Saving…"
              : `Apply ${parsed.length} vars${targets.length > 1 ? ` to ${targets.length} envs` : ""} →`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
