import { useEffect, useMemo, useState } from "react";
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
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import type { EnvironmentRef, EnvVarRow } from "./variables-types";

interface ParsedVar {
  key: string;
  value: string;
  isSecret: boolean;
}

function parseDotEnv(text: string): ParsedVar[] {
  const out: ParsedVar[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (k.startsWith("export ")) k = k.slice(7).trim();
    out.push({ key: k, value: v, isSecret: /SECRET|KEY|TOKEN|PASS|DSN/i.test(k) });
  }
  return out;
}

export function BulkEditDialog({
  projectId,
  env,
  currentRows,
  open,
  onOpenChange,
  onSaved,
}: {
  projectId: string;
  env: EnvironmentRef;
  currentRows: EnvVarRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const initial = useMemo(
    () => currentRows.map((v) => `${v.key}=${v.value}`).join("\n"),
    [currentRows],
  );
  const [text, setText] = useState(initial);

  // Re-hydrate when the dialog opens or the rows refetch so a stale
  // edit doesn't persist between visits to the same env tab.
  useEffect(() => {
    setText(initial);
  }, [initial]);

  const parsed = useMemo<ParsedVar[]>(() => parseDotEnv(text), [text]);

  const bulkMut = useMutation({
    ...orpc.project.envVar.bulkReplace.mutationOptions(),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      toast.success(
        `Saved ${parsed.length} variables to ${env.name || env.slug}`,
      );
    },
    onError: (err) => toast.error(err.message ?? "Couldn't save"),
  });

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

          <BulkEditSidebar env={env} parsed={parsed} />
        </div>

        <div className="flex items-center gap-2 border-t px-4 py-3">
          <span className="text-[11px] text-muted-foreground">
            Replaces every variable in {env.name || env.slug} atomically.
          </span>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={bulkMut.isPending}
            onClick={() =>
              bulkMut.mutate({
                projectId: projectId as never,
                environmentId: env.id as never,
                vars: parsed.map((p) => ({
                  key: p.key,
                  value: p.value,
                  isSecret: p.isSecret,
                })),
              })
            }
          >
            {bulkMut.isPending ? "Saving…" : `Apply ${parsed.length} vars →`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BulkEditSidebar({
  env,
  parsed,
}: {
  env: EnvironmentRef;
  parsed: ParsedVar[];
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Target environment
        </div>
        <div className="flex items-center gap-2 text-xs">
          <EnvDot slug={env.slug} />
          <span className="capitalize">{env.name || env.slug}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Cross-env apply is a follow-up. Bulk replace runs against this env only.
        </p>
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
