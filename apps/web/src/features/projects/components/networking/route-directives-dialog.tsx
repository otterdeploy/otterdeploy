/**
 * Per-route custom Caddy directives. A small trigger in the routes table opens
 * a dialog to edit directives spliced INSIDE this route's generated site block
 * (e.g. `header`, `encode`, `rate_limit`, `basic_auth`). Saving validates the
 * route's block via Caddy `/adapt`; invalid input is rejected (not persisted)
 * with the parse error shown inline. HTTP routes only.
 */

import type { ProxyRouteId } from "@otterdeploy/shared/id";

import { useState } from "react";

import { Alert02Icon, CodeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import {
  proxyRoutesCollection,
  RouteDirectivesRejectedError,
} from "@/features/projects/data/proxy-routes";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";

const PLACEHOLDER = `# Directives for this route's site block, e.g.
header {
\tStrict-Transport-Security "max-age=31536000"
}
encode gzip`;

export function RouteDirectivesButton({
  routeId,
  domain,
  customDirectives,
}: {
  routeId: string;
  domain: string;
  customDirectives: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(customDirectives ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hasDirectives = (customDirectives ?? "").trim().length > 0;

  const onSave = () => {
    setSaving(true);
    setError(null);
    const tx = proxyRoutesCollection.update(routeId as ProxyRouteId, (draft) => {
      draft.customDirectives = value.trim().length === 0 ? null : value;
    });
    tx.isPersisted.promise
      .then(() => {
        toast.success("Directives applied");
        setOpen(false);
      })
      .catch((e) => {
        // A Caddy parse rejection surfaces as RouteDirectivesRejectedError —
        // show it inline; other failures are toasted.
        if (e instanceof RouteDirectivesRejectedError) {
          setError(e.message);
          toast.error("Rejected — not saved");
        } else {
          toast.error(e instanceof Error ? e.message : "Failed to save directives");
        }
      })
      .finally(() => setSaving(false));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Re-hydrate when (re)opening so the editor reflects the saved value.
        if (next) {
          setValue(customDirectives ?? "");
          setError(null);
        }
      }}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit custom directives"
        title="Custom directives"
        className={cn("text-muted-foreground", hasDirectives && "text-foreground")}
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon icon={CodeIcon} strokeWidth={2} className="size-3.5" />
      </Button>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Custom directives</DialogTitle>
          <DialogDescription>
            Spliced inside the site block for{" "}
            <span className="font-mono text-foreground/80">{domain}</span>. Validated on save —
            invalid directives are rejected and not applied.
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          className="min-h-48 font-mono text-[12.5px] leading-relaxed"
          autoFocus
        />

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <HugeiconsIcon
              icon={Alert02Icon}
              strokeWidth={2}
              className="mt-0.5 size-4 shrink-0 text-destructive"
            />
            <pre className="min-w-0 overflow-x-auto font-mono text-[11.5px] whitespace-pre-wrap text-destructive/90">
              {error}
            </pre>
          </div>
        ) : null}

        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            disabled={saving || value === (customDirectives ?? "")}
          >
            {saving ? "Validating…" : "Save & apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
