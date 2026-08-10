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
 * Two states, separated by SHAPE as well as hue: at 8px, and for a colour-blind
 * operator, colour alone says nothing (DESIGN.md; the same rule the brand mark
 * follows in otterdeploy-logo.tsx):
 *
 *   failure → filled dot inside a matching halo, so it reads heavier than
 *             ordinary unread without relying on "red"
 *   unread  → plain filled dot in its severity colour
 */
export function BellBadge({ severity }: { severity: Severity | null }) {
  if (severity === null) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ring-background",
        SEVERITY_BADGE[severity],
        // The halo is the non-colour channel that separates a failure from
        // ordinary unread; ring-background alone would just be a plain dot.
        severity === "err" && "ring-destructive/35",
      )}
    />
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
