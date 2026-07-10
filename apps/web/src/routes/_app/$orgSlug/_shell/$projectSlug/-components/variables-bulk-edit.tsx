import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { parseDotEnv, type ParsedVar } from "./variables-dotenv";
import type { EnvironmentRef, EnvVarRow } from "./variables-types";

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
  const initial = useMemo(
    () => currentRows.map((v) => `${v.key}=${v.value}`).join("\n"),
    [currentRows],
  );
  const [text, setText] = useState(initial);

  // Re-hydrate when the dialog opens or the rows refetch so a stale
  // edit doesn't persist between visits to the same env tab. A dropped
  // .env file (prefillText) wins over the current rows.
  useEffect(() => {
    setText(prefillText ?? initial);
  }, [initial, prefillText]);

  // Cross-env targets — the current env is pre-checked each time the
  // dialog opens; others are opt-in.
  const [targetIds, setTargetIds] = useState<Set<string>>(new Set([env.id]));
  useEffect(() => {
    if (open) setTargetIds(new Set([env.id]));
  }, [open, env.id]);

  const toggleTarget = (envId: string) =>
    setTargetIds((s) => {
      const next = new Set(s);
      if (next.has(envId)) next.delete(envId);
      else next.add(envId);
      return next;
    });

  const parsed = useMemo<ParsedVar[]>(() => parseDotEnv(text), [text]);

  const targets = allEnvs.filter((e) => targetIds.has(e.id));
  const targetNames = targets.map((e) => e.name || e.slug).join(", ");

  const bulkMut = useMutation(orpc.project.envVar.bulkReplace.mutationOptions());
  const [saving, setSaving] = useState(false);

  // One atomic bulkReplace per selected env, run sequentially; failures
  // are collected so a partial failure reports exactly which envs missed.
  const apply = async () => {
    if (targets.length === 0 || saving) return;
    setSaving(true);
    const applied: EnvironmentRef[] = [];
    const failed: { env: EnvironmentRef; message: string }[] = [];
    for (const target of targets) {
      try {
        await bulkMut.mutateAsync({
          projectId: projectId as never,
          environmentId: target.id as never,
          vars: parsed.map((p) => ({
            key: p.key,
            value: p.value,
            isSecret: p.isSecret,
          })),
        });
        applied.push(target);
      } catch (err) {
        failed.push({
          env: target,
          message: err instanceof Error ? err.message : "Couldn't save",
        });
      }
    }
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

function BulkEditSidebar({
  allEnvs,
  targetIds,
  onToggleTarget,
  parsed,
}: {
  allEnvs: EnvironmentRef[];
  targetIds: Set<string>;
  onToggleTarget: (envId: string) => void;
  parsed: ParsedVar[];
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Apply to
        </div>
        <div className="flex flex-col gap-0.5">
          {allEnvs.map((e) => (
            <label
              key={e.id}
              className="flex cursor-pointer items-center gap-2 py-1 text-xs"
            >
              <Checkbox
                checked={targetIds.has(e.id)}
                onCheckedChange={() => onToggleTarget(e.id)}
                aria-label={`Apply to ${e.name || e.slug}`}
              />
              <EnvDot slug={e.slug} />
              <span className="capitalize">{e.name || e.slug}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Preview
        </div>
        <div className="font-mono text-xs text-foreground/80">
          {parsed.length} variables parsed
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">
          {parsed.filter((p) => p.isSecret).length} marked secret
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="min-h-0">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Detected
        </div>
        <div className="max-h-40 overflow-auto font-mono text-[11px] text-foreground/80">
          {parsed.slice(0, 12).map((p) => (
            <div key={p.key} className="flex gap-1.5 py-0.5">
              <span
                className={p.isSecret ? "text-amber-500" : "text-muted-foreground"}
              >
                {p.isSecret ? "••" : "  "}
              </span>
              <span className="truncate">{p.key}</span>
            </div>
          ))}
          {parsed.length > 12 && (
            <div className="text-[10px] text-muted-foreground">
              +{parsed.length - 12} more
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function EnvDot({ slug }: { slug: string }) {
  // Slug-based tone — production/main → emerald, staging → amber,
  // anything else (preview / feature branches) → blue.
  const tone =
    slug === "production" || slug === "main" || slug === "prod"
      ? "bg-emerald-500"
      : slug === "staging" || slug === "stage" || slug === "stg"
        ? "bg-amber-500"
        : "bg-blue-500";
  return <span className={cn("size-1.5 rounded-full", tone)} />;
}
