/**
 * Inline error state for in-shell content (routes, panels, cards): the
 * counterpart to {@link Empty}. NOT the full-screen ServerError; this lives
 * inside the page body when a live query / fetch fails, with an optional retry.
 *
 * The split between `title` and `message` is the whole point of this component:
 *
 *   title: HUMAN. What failed, in the operator's terms ("Couldn't load
 *             identity providers"). Every caller passes a raw server string as
 *             `message`, and a server string is frequently something like
 *             "Not Found". Technically accurate and useless on its own. The
 *             title is what makes the screen readable, so the default here is a
 *             last resort rather than something to settle for.
 *   message: MACHINE. The raw error text, rendered in mono and de-emphasized
 *             because that is what it is (DESIGN.md: sans for human-readable,
 *             mono for machine output). Kept verbatim. It is the string an
 *             operator pastes into a bug report, but boxed and height-capped
 *             so a stack-trace-length error cannot push the retry button off
 *             screen.
 */
import { Alert02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";

import { Button } from "./button";

export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  /** Human headline. Say what failed, not merely that something did. */
  title?: string;
  /** Raw error text from the server/transport. Rendered as machine output. */
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      // Announced to assistive tech: this replaces content the user was
      // waiting for, so it has to be more than a visual change.
      role="alert"
      className={cn(
        "flex w-full flex-col items-center gap-3 rounded-md border border-dashed bg-muted/20 px-8 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-5" />
      </div>
      <div className="flex max-w-md flex-col items-center gap-2">
        <p className="text-sm font-semibold">{title ?? t("errors.generic")}</p>
        {message ? (
          // Boxed rather than loose prose so it separates "what the server
          // said" from "what we're telling you". A terse status like
          // "Not Found" then reads as a quoted detail, not as the explanation.
          <p className="max-h-24 max-w-full overflow-y-auto rounded border bg-background px-2 py-1 font-mono text-[11px] break-words text-muted-foreground">
            {message}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-1 gap-1.5" onClick={onRetry}>
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
