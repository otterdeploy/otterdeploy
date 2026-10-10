/**
 * Confirming a change to a base domain that is already set.
 *
 * The thing worth stopping for is what does NOT happen: each service's
 * hostname is minted once, when it is exposed, and changing the base domain
 * rewrites only the workspace row (and restarts verification). So the dialog
 * lists the hostnames already serving under the old domain and says plainly
 * that they stay where they are.
 */

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Skeleton } from "@/shared/components/ui/skeleton";

/** The table and notice, apart from the dialog chrome, so they can be
 *  rendered and tested on their own. */
export function ChangeDomainSummary({
  current,
  hostnames,
  total,
}: {
  current: string;
  hostnames: string[];
  total: number;
}) {
  if (total === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        No services are published under <span className="font-mono">{current}</span> yet, so nothing
        else changes.
      </p>
    );
  }
  const more = total - hostnames.length;
  return (
    <>
      <div className="max-h-64 overflow-y-auto rounded-md border">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-muted text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Already exposed</th>
              <th className="px-2 py-1.5 text-left font-medium">After the change</th>
            </tr>
          </thead>
          <tbody>
            {hostnames.map((host) => (
              <tr key={host} className="border-t">
                <td className="px-2 py-1.5 font-mono break-all">{host}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                  Keeps this hostname
                </td>
              </tr>
            ))}
            {more > 0 ? (
              <tr className="border-t">
                <td colSpan={2} className="px-2 py-1.5 text-muted-foreground">
                  and {more} more, which also keep their hostnames
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] text-muted-foreground">
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-px size-3.5 shrink-0" />
        <span>
          Keep the DNS for <span className="font-mono text-foreground">{current}</span> in place
          while these services use it. A service moves only when you change its domain in its own
          settings.
        </span>
      </p>
    </>
  );
}

export function ChangeDomainDialog({
  open,
  onOpenChange,
  current,
  next,
  impact,
  loading,
  saving,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: string;
  /** Empty when the domain is being removed. */
  next: string;
  /** The hostnames already serving under `current` (organization.baseDomainHostnames). */
  impact: { hostnames: string[]; total: number } | undefined;
  loading: boolean;
  saving: boolean;
  onConfirm: () => void;
}) {
  const removing = next.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {removing ? (
              "Remove the base domain?"
            ) : (
              <>
                Change base domain to <span className="font-mono">{next}</span>?
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {removing
              ? "New services will publish on a temporary sslip.io address on this server's IP. Nothing already exposed is renamed."
              : `New services will publish under ${next}. Nothing already exposed is renamed, and ownership has to be verified again.`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <Skeleton className="h-24 rounded-md" />
        ) : (
          <ChangeDomainSummary
            current={current}
            hostnames={impact?.hostnames ?? []}
            total={impact?.total ?? 0}
          />
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={onConfirm}>
            {saving ? "Saving…" : removing ? "Remove domain" : "Change domain"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
