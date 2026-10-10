import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { badgeBase, label, type PreviewService } from "./shared";

export function VariablesTab(props: {
  projectId: string;
  previewId: string;
  service: PreviewService;
}) {
  const { projectId, previewId, service } = props;
  const queryClient = useQueryClient();
  const scope = { projectId, previewId, serviceResourceId: service.resourceId };
  const effOptions = orpc.project.previews.envVars.effective.queryOptions({
    input: scope,
    refetchInterval: 5_000,
  });
  const eff = useQuery(effOptions);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: effOptions.queryKey });

  const set = useMutation(
    orpc.project.previews.envVars.set.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to set override"),
    }),
  );
  const unset = useMutation(
    orpc.project.previews.envVars.unset.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to revert"),
    }),
  );

  const form = useForm({
    defaultValues: { key: "", value: "" },
    onSubmit: async ({ value: v }) => {
      try {
        await set.mutateAsync({ ...scope, key: v.key.trim(), value: v.value });
        form.reset();
      } catch {
        /* toast fired */
      }
    },
  });

  const rows = eff.data ?? [];

  return (
    <div className="mb-6">
      <div className={label}>{service.serviceName}</div>
      <div className="mt-2 overflow-hidden rounded-lg border border-border/60">
        <div className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-3 border-b border-border/60 bg-muted/30 px-3 py-1.5">
          <span className={label}>key</span>
          <span className={label}>value</span>
          <span className={label}>source</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-[13px] text-muted-foreground">
            {eff.isLoading ? "Loading…" : "No variables."}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {rows.map((row) => (
              <li
                key={row.key}
                className="grid grid-cols-[1fr_1.4fr_auto] items-center gap-3 px-3 py-2"
              >
                <span className="truncate font-mono text-[12.5px] font-medium">{row.key}</span>
                <span
                  className={cn(
                    "truncate font-mono text-[12.5px]",
                    row.source === "override" ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {row.value}
                </span>
                {row.source === "override" ? (
                  <span className="flex items-center gap-1.5">
                    <span className={cn(badgeBase, "bg-info/12 text-info")}>override</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Revert ${row.key} to inherited`}
                      title={row.baseValue ? `Revert to base: ${row.baseValue}` : "Remove override"}
                      disabled={unset.isPending}
                      onClick={() => unset.mutate({ ...scope, key: row.key })}
                    >
                      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
                    </Button>
                  </span>
                ) : (
                  <span className={cn(badgeBase, "bg-muted text-muted-foreground")}>inherited</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        className="mt-2 flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="key"
          validators={{
            onChange: ({ value: v }) =>
              v.trim().length === 0
                ? "Required"
                : /^[A-Za-z_][A-Za-z0-9_]*$/.test(v.trim())
                  ? undefined
                  : "Letters, digits and _ only",
          }}
        >
          {(field) => (
            <div className="flex max-w-44 flex-col gap-1">
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="KEY"
                className="h-8 font-mono text-[12px]"
                aria-label="Override key"
              />
              {field.state.meta.isTouched && field.state.meta.errors.length > 0 ? (
                <em className="text-[11px] not-italic text-destructive">
                  {field.state.meta.errors.join(", ")}
                </em>
              ) : null}
            </div>
          )}
        </form.Field>
        <form.Field name="value">
          {(field) => (
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="value (overrides the inherited one)"
              className="h-8 flex-1 font-mono text-[12px]"
              aria-label="Override value"
            />
          )}
        </form.Field>
        <form.Subscribe
          selector={(st) => ({ canSubmit: st.canSubmit, submitting: st.isSubmitting })}
        >
          {({ canSubmit, submitting }) => (
            <Button type="submit" variant="outline" size="sm" disabled={!canSubmit || submitting}>
              {submitting ? "…" : "Add override"}
            </Button>
          )}
        </form.Subscribe>
      </form>
    </div>
  );
}
