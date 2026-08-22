/**
 * The badge on the header bell, and the accessible label that describes it.
 *
 * Split out of inbox-popover.tsx so the popover file stays about the popover:
 * this is the one place that decides how unread state becomes an 8px dot.
 */

import type { Severity } from "@/features/notifications/shared";

import { SEVERITY_BADGE } from "@/features/notifications/shared";
import { cn } from "@/shared/lib/utils";

/**
 * The bell answers exactly one question: "is there anything I have not looked
 * at?" It used to answer a second one ("is anything building right now?") as a
 * pulsing accent ring, and that was wrong twice over. The ring read as an alarm
 * for what is ordinary progress, and it was sourced from the PROJECT-scoped
 * app-status rollup, so it went dark the moment you navigated away from the
 * project doing the building. A badge that is silent about most of your builds
 * is worse than no badge. Live work now lives in the header activity indicator
 * (features/activity/activity-indicator.tsx), which is org-wide and says what is
 * building rather than just that something is.
 *
 * It shows the COUNT, not just a dot. The number was already on the wire (the
 * inbox list returns `unread` alongside its items) and already reached screen
 * readers through {@link bellLabel}, while sighted users got an undifferentiated
 * 8px dot: two unread and forty unread looked identical. Reporting one to
 * assistive tech and withholding it from everyone else is the wrong way round.
 *
 * Severity still separates by SHAPE as well as hue, because at this size, and
 * for a colour-blind operator, colour alone says nothing (DESIGN.md; the same
 * rule the brand mark follows in otterdeploy-logo.tsx):
 *
 *   failure → count inside a matching halo, so it reads heavier than ordinary
 *             unread without relying on "red"
 *   unread  → count in its severity colour
 */
export function BellBadge({ severity, count }: { severity: Severity | null; count: number }) {
  if (severity === null || count <= 0) return null;
  // Past 9 the exact number stops being actionable and starts being a layout
  // problem: the badge would grow wider than the button it sits on.
  const shown = count > 9 ? "9+" : String(count);
  return (
    <span
      aria-hidden
      className={cn(
        "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1",
        "font-mono text-[10px] leading-none font-medium text-background tabular-nums",
        "ring-2 ring-background",
        SEVERITY_BADGE[severity],
        // The halo is the non-colour channel that separates a failure from
        // ordinary unread; ring-background alone would just be a plain pill.
        severity === "err" && "ring-destructive/35",
      )}
    >
      {shown}
    </span>
  );
}

/**
 * What a screen reader hears. The badge is `aria-hidden`, so every state it can
 * show has to reach assistive tech through this string or it is invisible to one.
 *
 * Takes the already-translated pieces rather than calling `t` itself, so it stays
 * a pure function the tests can pin without an i18n context.
 */
export function bellLabel(parts: { unread: string; failure: string | null }): string {
  return [parts.unread, parts.failure].filter(Boolean).join(", ");
}
