/**
 * Every install command this organization has created, newest first, with a
 * revoke for the ones that could still be used. Opened from the dialog
 * footer's "N earlier commands".
 */

import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { epochMsFromIso } from "@/shared/lib/clock";
import { relativeMs } from "@/shared/lib/time";

import type { EnrollmentProgressRow, EnrollmentStatus } from "../components/enrollment-progress";
import type { EnrollmentRow } from "./command-flow";

/** What became of a command, in the words the rest of the dialog uses. */
const STATUS_WORD: Record<EnrollmentStatus, string> = {
  active: "Unused",
  redeemed: "Installing",
  completed: "Connected",
  expired: "Expired",
  revoked: "Revoked",
};

function createdAgo(row: EnrollmentProgressRow): string {
  const ms = epochMsFromIso(row.createdAt);
  return ms === null ? "" : relativeMs(ms);
}

/** A command can be revoked while it could still let a server in. */
function revocable(status: EnrollmentStatus): boolean {
  return status === "active" || status === "redeemed";
}

export function EarlierCommands({
  rows,
  revoking,
  onRevoke,
}: {
  rows: readonly EnrollmentRow[];
  revoking: boolean;
  onRevoke: (id: EnrollmentRow["id"]) => void;
}) {
  return (
    <section aria-label="Earlier commands" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Earlier commands</h3>
      <ul className="max-h-60 divide-y overflow-y-auto rounded-md ring-1 ring-foreground/10">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center gap-3 py-1.5 pr-1.5 pl-3 text-sm">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {row.id}
            </code>
            {row.role === "manager" ? <Badge variant="secondary">control plane</Badge> : null}
            <span className="w-20 shrink-0">{STATUS_WORD[row.status]}</span>
            <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
              <span className="sr-only">created </span>
              {createdAgo(row)}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Revoke ${row.id}`}
              disabled={revoking || !revocable(row.status)}
              onClick={() => onRevoke(row.id)}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
