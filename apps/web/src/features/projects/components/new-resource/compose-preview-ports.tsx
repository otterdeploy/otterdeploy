/**
 * The published-port pills for one container, and what clicking one means.
 *
 * A pill is a toggle: on means this port gets a public hostname (the row
 * beneath it). Split from `compose-preview.tsx` to keep that component under
 * the per-function line cap.
 */
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";

import type { DetectedService } from "./compose-wizard-shared";

/** The ports an HTTP route can front: the tcp subset. Falls back to every
 *  declared port for a summary stored before `httpPorts` existed. */
export function routablePorts(s: DetectedService): number[] {
  return s.httpPorts ?? s.ports;
}

export function ComposePreviewPorts({
  service: s,
  exposed,
  onToggle,
}: {
  service: DetectedService;
  exposed: Set<string>;
  onToggle: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {s.ports.map((p) => {
        // A udp port is host-published and the edge speaks HTTP, so it
        // can never carry a public route. Show it, greyed and inert,
        // rather than offering a toggle that would mint a dead hostname.
        if (!routablePorts(s).includes(p)) {
          return (
            <Tooltip key={p}>
              <TooltipTrigger
                render={
                  <span className="cursor-default rounded-full bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground/60">
                    :{p}/udp
                  </span>
                }
              />
              <TooltipContent side="top">
                <div className="flex max-w-[15rem] flex-col gap-0.5 text-left">
                  <div className="text-xs font-medium">{t("compose.udpTitle")}</div>
                  <div className="text-[10px] opacity-80">{t("compose.udpBody")}</div>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        }
        const key = `${s.name}:${p}`;
        const on = exposed.has(key);
        return (
          <Tooltip key={p}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(key)}
                  className={
                    on
                      ? "rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] text-primary-foreground"
                      : "rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted/70"
                  }
                >
                  {on ? "🌐 " : ""}:{p}
                </button>
              }
            />
            <TooltipContent side="top">
              <div className="flex max-w-[16rem] flex-col gap-0.5 text-left">
                <div className="text-xs font-medium">
                  {on ? t("compose.exposedTitle") : t("compose.exposeTitle")}
                </div>
                <div className="text-[10px] opacity-80">
                  {on ? t("compose.exposedBody") : t("compose.exposeBody")}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}
