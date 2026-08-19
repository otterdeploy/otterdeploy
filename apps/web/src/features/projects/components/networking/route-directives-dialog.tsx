import type { RoutePolicy } from "@otterdeploy/shared/route-policy";

import { useState } from "react";

import { Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { idSchema } from "@otterdeploy/shared/id";
import { toast } from "sonner";

import { CustomDirectivesField } from "@/features/projects/components/networking/route-custom-directives-field";
import { RoutePolicyFields } from "@/features/projects/components/networking/route-policy-fields";
import {
  proxyRoutesCollection,
  RoutePolicyRejectedError,
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

const copyPolicy = (policy: RoutePolicy): RoutePolicy => ({ ...policy });

export function RoutePolicyButton({
  routeId,
  domain,
  routePolicy,
  customDirectives,
}: {
  routeId: string;
  domain: string;
  routePolicy: RoutePolicy;
  customDirectives: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => copyPolicy(routePolicy));
  const [directivesDraft, setDirectivesDraft] = useState(
    () => customDirectives ?? "",
  );
  // Caddy's rejection message for the raw block, shown inline next to the
  // editor rather than only as a toast: the user needs it while fixing text.
  const [directivesError, setDirectivesError] = useState<string | null>(null);

  const update = <K extends keyof RoutePolicy>(
    key: K,
    value: RoutePolicy[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    setDirectivesError(null);
    const nextDirectives =
      directivesDraft.trim() === "" ? null : directivesDraft;
    // The row model widens ids to string; re-brand at the mutation boundary.
    const tx = proxyRoutesCollection.update(
      idSchema.proxyRoute.parse(routeId),
      (row) => {
        row.routePolicy = draft;
        if (nextDirectives !== (customDirectives ?? null)) {
          row.customDirectives = nextDirectives;
        }
      },
    );
    try {
      await tx.isPersisted.promise;
      toast.success("Route policy applied");
      setOpen(false);
    } catch (error) {
      const message =
        error instanceof RoutePolicyRejectedError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to save route policy";
      setDirectivesError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(copyPolicy(routePolicy));
          setDirectivesDraft(customDirectives ?? "");
          setDirectivesError(null);
        }
      }}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit route policy and custom directives"
        title="Route policy"
        onClick={() => setOpen(true)}
      >
        <HugeiconsIcon
          icon={Settings02Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </Button>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Route policy</DialogTitle>
          <DialogDescription>
            Edge behavior for <span className="font-mono">{domain}</span>.
            Structured options below, plus raw Caddyfile directives appended
            inside this domain&apos;s site block.
          </DialogDescription>
        </DialogHeader>

        <RoutePolicyFields draft={draft} update={update} />

        <CustomDirectivesField
          value={directivesDraft}
          onValueChange={(value) => {
            setDirectivesDraft(value);
            setDirectivesError(null);
          }}
          error={directivesError}
        />

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            disabled={saving}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {saving ? "Applying…" : "Save & apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
