/**
 * Inline error state for in-shell content (routes, panels, cards) — the
 * counterpart to {@link Empty}. NOT the full-screen ServerError; this lives
 * inside the page body when a live query / fetch fails, with an optional retry.
 */
import { Alert02Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "@/shared/lib/utils";
import { Button } from "./button";

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-center p-8",
        className,
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-dashed bg-card/40 px-8 py-10 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-5" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-semibold">{title}</p>
          {message ? (
            <p className="text-xs break-words text-muted-foreground">
              {message}
            </p>
          ) : null}
        </div>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-1 gap-1.5"
            onClick={onRetry}
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="size-3.5" />
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
