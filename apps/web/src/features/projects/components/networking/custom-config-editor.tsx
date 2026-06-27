/**
 * Editor for a project's operator-authored Caddy config — standalone site
 * blocks / snippets appended to the project's generated fragment. Saving
 * validates the combined config server-side via Caddy `/adapt`; invalid input
 * is rejected (not persisted) and Caddy's parse error is surfaced inline, so a
 * typo can never take the project's real routes offline.
 */

import { useEffect, useState } from "react";

import { Alert02Icon, CheckmarkCircle02Icon, ServerStack01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { CaddyCodeEditor } from "@/features/projects/components/networking/caddy-code-editor";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";
import { orpc, queryClient } from "@/shared/server/orpc";

const PLACEHOLDER = `# Standalone Caddy site blocks for this project, e.g.
redirect.example.com {
\tredir https://example.com{uri}
}`;

export function CustomConfigEditor({ projectId }: { projectId: string }) {
  const configQuery = useQuery(
    orpc.project.proxyRoute.customConfig.queryOptions({
      input: { projectId: projectId as never },
    }),
  );

  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loaded = configQuery.data?.config ?? "";

  // Hydrate the editor once the saved config arrives (and on project switch).
  useEffect(() => {
    setValue(configQuery.data?.config ?? "");
    setError(null);
  }, [configQuery.data?.config]);

  const save = useMutation({
    ...orpc.project.proxyRoute.setCustomConfig.mutationOptions(),
    onSuccess: (result) => {
      if (result.applied) {
        setError(null);
        toast.success("Custom config applied");
        void queryClient.invalidateQueries({
          queryKey: orpc.project.proxyRoute.customConfig.key({
            input: { projectId: projectId as never },
          }),
        });
        void queryClient.invalidateQueries({
          queryKey: orpc.project.proxyRoute.caddyfile.key({
            input: { projectId: projectId as never },
          }),
        });
      } else {
        // Validation failed — config was NOT saved. Show Caddy's error.
        setError(result.error ?? "Caddy rejected this config");
        toast.error("Config rejected — not saved");
      }
    },
    onError: (e) => toast.error(e.message ?? "Failed to save config"),
  });

  const dirty = value !== loaded;

  const onSave = () =>
    save.mutate({
      projectId: projectId as never,
      config: value.trim().length === 0 ? null : value,
    });

  if (configQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-8 w-28 self-end" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Custom config</h2>
          <p className="mt-0.5 max-w-2xl text-[13px] text-muted-foreground">
            Caddy blocks appended to this project's generated config — define your own sites,
            redirects, or reusable snippets. Validated on save; if it doesn't parse, nothing is
            applied and your routes keep serving.
          </p>
        </div>
      </div>

      <CaddyCodeEditor
        value={value}
        onValueChange={(next) => {
          setValue(next);
          if (error) setError(null);
        }}
        placeholder={PLACEHOLDER}
        className="h-72"
      />

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
          <HugeiconsIcon
            icon={Alert02Icon}
            strokeWidth={2}
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-destructive">
              Caddy rejected this config — nothing was saved
            </div>
            <pre className="mt-1 overflow-x-auto font-mono text-[11.5px] whitespace-pre-wrap text-destructive/90">
              {error}
            </pre>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <HugeiconsIcon icon={ServerStack01Icon} strokeWidth={1.8} className="size-3.5" />
          See the merged result on the{" "}
          <span className="font-mono text-foreground/80">Caddyfile</span> tab.
        </p>
        <div className="flex items-center gap-2">
          {dirty ? (
            <span className="text-[12px] text-muted-foreground">Unsaved changes</span>
          ) : (
            <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
              <HugeiconsIcon
                icon={CheckmarkCircle02Icon}
                strokeWidth={2}
                className={cn("size-3.5", error ? "hidden" : "text-success")}
              />
              {error ? "" : "Saved"}
            </span>
          )}
          <Button size="sm" onClick={onSave} disabled={!dirty || save.isPending}>
            {save.isPending ? "Validating…" : "Save & apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
