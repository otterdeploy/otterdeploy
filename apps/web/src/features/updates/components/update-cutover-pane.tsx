/**
 * The cutover wait for {@link UpdateProgress}: the control plane is down on
 * purpose, so the brand mark holds the room while the probe counter shows the
 * wait as visible work. Reset only appears once the wait has crossed the stuck
 * threshold; before that, offering an escape hatch during every normal cutover
 * just invites panic-clicks.
 */
import { useTranslation } from "react-i18next";

import { OtterdeployMark } from "@/shared/components/brand/otterdeploy-logo";
import { Button } from "@/shared/components/ui/button";

import { formatClock } from "./update-progress-clock";

export function CutoverPane({
  target,
  probes,
  waitedMs,
  stuck,
  resetPending,
  onReset,
}: {
  target: string;
  probes: number;
  waitedMs: number;
  stuck: boolean;
  resetPending: boolean;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-1.5 px-2 py-8 text-center">
      <div className="mb-2 motion-safe:animate-pulse">
        <OtterdeployMark size={28} status="deploying" />
      </div>
      <div className="text-base font-semibold">{t("updates.cutoverTitle")}</div>
      <div className="font-mono text-[11.5px] text-muted-foreground">
        {t("updates.cutoverProbe", { target, count: probes })} · {formatClock(waitedMs)}
      </div>
      {stuck ? (
        <>
          <p className="mt-2 max-w-[42ch] text-xs text-muted-foreground">
            {t("updates.stuckHint", { count: probes })}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1 text-destructive"
            disabled={resetPending}
            onClick={onReset}
          >
            {resetPending ? t("updates.resetting") : t("updates.resetStuck")}
          </Button>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground/70">{t("updates.cutoverReload")}</p>
      )}
    </div>
  );
}
