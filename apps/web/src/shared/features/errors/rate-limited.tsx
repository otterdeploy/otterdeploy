import { useEffect, useState } from "react";

import { Clock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { Button } from "@/shared/components/ui/button";

import { epochMs, startRetryCountdown } from "./retry-countdown";

/**
 * The "slow down" state: what the error boundary shows when a page could not
 * load because the server rate-limited this client. A 429 is not a fault, so
 * this is the product's own quiet surface (sentence case, one muted line, the
 * shell's type and colour), not the loud 500 screen: it says what happened,
 * that the session is fine, counts down the server's own retry hint, and
 * retries by itself when the count reaches zero. "Retry now" skips the wait.
 * No motion beyond the number changing, so nothing to reduce.
 */
export function RateLimited({
  retryAfterSeconds,
  onRetry,
}: {
  /** The server's retry hint, already clamped (see rate-limited.ts). */
  retryAfterSeconds: number;
  /** Re-run the failed load (the router boundary's `reset`). */
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  // A deadline, not a decrementing counter: a throttled background tab skips
  // ticks, and the countdown must still say how long is actually left.
  const [deadline] = useState(() => epochMs() + retryAfterSeconds * 1_000);
  const [remaining, setRemaining] = useState(retryAfterSeconds);

  // Subscribe to the countdown. Its tick is what changes the count, and the
  // tick that reaches zero is what retries.
  useEffect(
    () => startRetryCountdown({ deadline, onTick: setRemaining, onDone: onRetry }),
    [deadline, onRetry],
  );

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded-lg bg-card p-6 ring-1 ring-foreground/10">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
            <HugeiconsIcon icon={Clock01Icon} className="size-4" aria-hidden="true" />
          </span>
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold tracking-tight">
              {t("errors.rateLimited.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("errors.rateLimited.message")}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
            {remaining > 0
              ? t("errors.rateLimited.retryingIn", { count: remaining })
              : t("errors.rateLimited.retrying")}
          </p>
          <Button size="sm" variant="outline" onClick={() => onRetry()}>
            {t("errors.rateLimited.retryNow")}
          </Button>
        </div>
      </div>
    </div>
  );
}
