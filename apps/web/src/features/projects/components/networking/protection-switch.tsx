/**
 * The auth-wall (deployment protection) toggle for one HTTP route. Shared
 * by the Routes-table cell and the Networking → Access tab. Mutates the
 * shared `proxyRoutesCollection`: the optimistic flip is instant and rolls
 * back (with a toast) if the server rejects.
 */

import { zId } from "@otterdeploy/shared/id";
import { toast } from "sonner";

import { proxyRoutesCollection } from "@/features/projects/data/proxy-routes";
import { Switch } from "@/shared/components/ui/switch";

/** Callers hand routes around as `{ id: string }`; parse back to the branded
 *  id at the collection boundary instead of asserting. */
const routeIdSchema = zId("rt");

/**
 * The status beside the switch, in a box sized to the longer of the two
 * states so toggling never moves the switch out from under the pointer (the
 * column is shared, so an intrinsic width re-flowed every other row too).
 *
 * Sentence-case UI text with a status dot — not mono: mono is for machine
 * text (IDs, hashes, logs); "Login required" is product vocabulary.
 */
export function ProtectionStateLabel({ isProtected }: { isProtected: boolean }) {
  return (
    <span className="flex w-[15ch] shrink-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <span
        className={`size-1.5 shrink-0 rounded-full ${isProtected ? "bg-info" : "bg-muted-foreground/50"}`}
      />
      {isProtected ? "Login required" : "Public"}
    </span>
  );
}

export function ProtectionSwitch({
  route,
}: {
  route: { id: string; protected: boolean };
  projectId: string;
}) {
  const onToggle = (checked: boolean) => {
    // Parse, don't cast: the row's id travels as a plain string through the
    // table's view types — validate the brand at the mutation boundary.
    const tx = proxyRoutesCollection.update(routeIdSchema.parse(route.id), (draft) => {
      draft.protected = checked;
    });
    tx.isPersisted.promise
      .then(() =>
        toast.success(checked ? "Deployment protection enabled" : "Deployment protection disabled"),
      )
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Failed to update protection"),
      );
  };

  return (
    <Switch
      checked={route.protected}
      onCheckedChange={onToggle}
      aria-label="Require login to view this deployment"
    />
  );
}
