/**
 * Live parse preview for the Compose wizard's inline file: spinner while
 * parsing, the YAML error band, or the detected-services list with per-port
 * expose toggles. Split out of compose-wizard.tsx to keep that file under
 * the max-lines cap.
 */

import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { ServiceImageIcon } from "@/shared/components/brand/service-image-icon";
import { Badge } from "@/shared/components/ui/badge";
import { Spinner } from "@/shared/components/ui/spinner";

import type { DetectedService, Preview } from "./compose-wizard-shared";

export function ComposePreview({
  parsing,
  preview,
  buildServices,
  exposed,
  onToggleExpose,
}: {
  parsing: boolean;
  preview: Preview | null;
  buildServices: DetectedService[];
  exposed: Set<string>;
  onToggleExpose: (key: string) => void;
}) {
  const { t } = useTranslation();
  if (parsing && !preview) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" /> {t("common.parsing")}
      </div>
    );
  }
  if (!preview) return null;
  if (!preview.valid) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">
          {preview.errorLine ? (
            <span className="mr-1.5 rounded bg-destructive/15 px-1 py-0.5 font-mono text-[11px]">
              {preview.errorColumn
                ? t("compose.errorLineColumn", {
                    line: preview.errorLine,
                    column: preview.errorColumn,
                  })
                : t("compose.errorLine", { line: preview.errorLine })}
            </span>
          ) : null}
          {preview.error ?? t("compose.invalidFile")}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{t("compose.stackRuns")}</span>
      <div className="flex flex-col gap-1.5">
        {preview.services.map((s) => (
          <div key={s.name} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <ServiceImageIcon image={s.image} className="size-4 shrink-0" />
            <span className="font-mono text-[13px]">{s.name}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {s.image ?? t("compose.buildsFromSource")}
            </span>
            <div className="flex-1" />
            {/* A service that publishes no port cannot be reached from outside
                the stack. Saying so beats an empty gap the operator has to
                read as an absence. */}
            {s.ports.length === 0 && !s.hasBuild ? (
              <span className="font-mono text-[10px] text-muted-foreground/60">
                {t("compose.internal")}
              </span>
            ) : null}
            {s.ports.map((p) => {
              const key = `${s.name}:${p}`;
              const on = exposed.has(key);
              return (
                <button
                  key={p}
                  type="button"
                  title={on ? t("compose.exposedTitle") : t("compose.exposeTitle")}
                  onClick={() => onToggleExpose(key)}
                  className={
                    on
                      ? "rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] text-primary-foreground"
                      : "rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted/70"
                  }
                >
                  {on ? "🌐 " : ""}:{p}
                </button>
              );
            })}
            {s.hasBuild ? (
              <Badge
                variant="outline"
                className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600"
              >
                build
              </Badge>
            ) : null}
          </div>
        ))}
      </div>
      {/* The port pills are toggles, which is not obvious from looking at
          them. Say it once, under the list, only when there is one to click. */}
      {preview.services.some((s) => s.ports.length > 0) ? (
        <p className="text-[11px] text-muted-foreground">{t("compose.exposeHint")}</p>
      ) : null}
      {buildServices.length > 0 ? (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-600">
          <HugeiconsIcon icon={Alert02Icon} className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {t("compose.buildUnsupportedBefore", {
              services: buildServices.map((s) => s.name).join(", "),
            })}{" "}
            <code>image:</code> {t("compose.buildUnsupportedAfter")}
          </span>
        </div>
      ) : null}
      {preview.warnings.map((w) => (
        <p key={w} className="text-[11px] text-muted-foreground">
          · {w}
        </p>
      ))}
    </div>
  );
}
