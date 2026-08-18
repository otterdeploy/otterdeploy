/**
 * Presentational pieces of the service Logs tab (see ./logs.tsx): one rendered
 * log row and the toolbar's right-side controls. Split out to keep the tab
 * under the module line cap; all state stays with the tab.
 */

import {
  Clock01Icon,
  Copy01Icon,
  Delete02Icon,
  PauseIcon,
  PlayIcon,
  TextWrapIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import {
  LEVEL_ROW_TEXT,
  LEVEL_STRIPE,
  type LogLine,
} from "@/features/logs/data/use-project-log-stream";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

export function LogRow({ line, wrap, showTs }: { line: LogLine; wrap: boolean; showTs: boolean }) {
  return (
    <div className="flex items-stretch gap-2.5">
      <span className={cn("w-[3px] shrink-0 rounded-full", LEVEL_STRIPE[line.level])} />
      {showTs && <span className="shrink-0 text-muted-foreground/50">{line.ts}</span>}
      <span
        className={cn(
          LEVEL_ROW_TEXT[line.level],
          wrap ? "break-all whitespace-pre-wrap" : "whitespace-pre",
        )}
      >
        {line.msg}
      </span>
    </div>
  );
}

/** The toolbar's right-side controls. Wrap toggle, pause/resume, copy. */
export function TailControls({
  wrap,
  onToggleWrap,
  paused,
  onTogglePause,
  onCopy,
  onClear,
  showTs,
  onToggleTs,
}: {
  wrap: boolean;
  onToggleWrap: () => void;
  paused: boolean;
  onTogglePause: () => void;
  onCopy: () => void;
  onClear: () => void;
  showTs: boolean;
  onToggleTs: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="ml-auto flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-7 gap-1.5 text-[12px]", !wrap && "text-muted-foreground/60")}
        onClick={onToggleWrap}
      >
        <HugeiconsIcon icon={TextWrapIcon} strokeWidth={2} className="size-3.5" />
        {t("logs.wrap")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("logs.timestamps")}
        aria-pressed={showTs}
        className={cn(!showTs && "text-muted-foreground/60")}
        onClick={onToggleTs}
      >
        <HugeiconsIcon icon={Clock01Icon} strokeWidth={2} className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 text-[12px]"
        onClick={onTogglePause}
      >
        <HugeiconsIcon icon={paused ? PlayIcon : PauseIcon} strokeWidth={2} className="size-3.5" />
        {paused ? t("logs.resume") : t("logs.pause")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("logs.copyVisibleLines")}
        onClick={onCopy}
      >
        <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} className="size-3.5" />
      </Button>
      {/* The tail is a rolling history: it survives restarts on purpose, so
          the crash output that CAUSED a restart stays readable. This is the
          explicit "start my reading here" wipe; the stream keeps flowing. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("logs.clearView")}
        onClick={onClear}
      >
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
      </Button>
    </div>
  );
}
