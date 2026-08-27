/**
 * The shared silhouette for everything in the registries grid.
 *
 * Two different things sit in that list — a stored credential and the GHCR
 * entry derived from the workspace's GitHub App — and before this they were
 * drawn by two hand-rolled shells that had quietly diverged (`bg-card` on one,
 * `ring-foreground/5` on the other; 32px logo vs 20px; a `border-t` footer vs
 * none). They are siblings in one list and should read as one kind of object,
 * with the difference carried by what they SAY, not by how they are built.
 *
 * The shell owns the shape only. It deliberately holds no actions and no
 * status: a credential can be tested, edited and deleted, while the derived
 * GHCR entry has nothing to rotate and nothing to remove, so each caller
 * supplies its own `action` and footer content.
 */

import type { ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

export function RegistryCardShell({
  logo,
  title,
  badge,
  subtitle,
  description,
  action,
  children,
  /** Renders the title in mono. For a bare host (`ghcr.io`) rather than a
   *  human-chosen display name — the Two-Cuts Rule in DESIGN.md. */
  monoTitle = false,
}: {
  logo: ReactNode;
  title: string;
  badge?: ReactNode;
  /** One machine-readable line (`user@host`). Mono, truncated: it identifies,
   *  so a clipped tail still identifies. */
  subtitle?: ReactNode;
  /** Prose. Wraps rather than truncating — a half sentence is not a shorter
   *  sentence, it's a different one. */
  description?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  monoTitle?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-px shrink-0">{logo}</span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className={cn("truncate text-sm font-semibold", monoTitle && "font-mono")}>
              {title}
            </span>
            {badge !== undefined && (
              <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
                {badge}
              </span>
            )}
          </div>
          {subtitle !== undefined && (
            <div className="truncate font-mono text-xs text-muted-foreground">{subtitle}</div>
          )}
        </div>
        {action}
      </div>
      {description !== undefined && (
        <p className="text-[12.5px] text-pretty text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}

/**
 * Footer strip: low-value metadata on the left, the card's one action on the
 * right. A hairline `border-t`, not a full divider block — it separates two
 * timestamps from the identity above, which is all the weight that earns.
 */
export function RegistryCardFooter({ meta, children }: { meta: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 border-t pt-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {meta}
      </div>
      {children}
    </div>
  );
}
