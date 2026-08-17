/**
 * The value half of an {@link EditorRow}: a masked-until-revealed input with
 * the `${{ … }}` reference picker anchored inside it.
 *
 * Split out of `editor-row.tsx` purely to keep that file under the 250-line
 * cap; nothing here is used anywhere else.
 */

import { ReferencePicker } from "@/features/projects/components/variables";
import { Input } from "@/shared/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";

import type { DraftRow } from "./use-editor-state";

import { hasOpenRefToken, insertRefToken } from "../ref-token";

export interface ValueCellProps {
  row: DraftRow;
  projectId: string;
  revealed: boolean;
  pickerOpen: boolean;
  onChange: (patch: Partial<Pick<DraftRow, "key" | "value" | "isSecret">>) => void;
  onPickerOpenChange: (open: boolean) => void;
  onToggleReveal: () => void;
}

export function ValueCell({
  row,
  projectId,
  revealed,
  pickerOpen,
  onChange,
  onPickerOpenChange,
  onToggleReveal,
}: ValueCellProps) {
  const showValue = !row.isSecret || revealed;
  return (
    <div className="relative min-w-0 flex-1">
      <Input
        value={showValue ? row.value : row.value.replace(/./g, "•")}
        onChange={(e) => {
          const next = e.target.value;
          // Typing the reference opener (`${{`) pops the picker right there:
          // the advertised trigger, not just the { } button. Only on the
          // TRANSITION into an open token so backspacing/editing around an
          // already-open fragment doesn't keep re-opening it.
          if (!pickerOpen && hasOpenRefToken(next) && !hasOpenRefToken(row.value)) {
            onPickerOpenChange(true);
          }
          onChange({ value: next });
        }}
        onFocus={() => {
          if (row.isSecret && !revealed) onToggleReveal();
        }}
        placeholder="value"
        className="h-7 w-full pr-9 font-mono text-[12px]"
        spellCheck={false}
      />
      {/* Popover, not an inline block: it renders in a portal so the picker
          floats over the rows below instead of pushing them down, and the
          refs list is cache-warmed at the editor level so it opens instantly. */}
      <Popover open={pickerOpen} onOpenChange={onPickerOpenChange}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Insert reference"
              title="Insert reference"
              className={cn(
                "absolute top-1/2 right-1 grid size-5 -translate-y-1/2 place-items-center rounded transition-colors",
                pickerOpen
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground/70 hover:bg-muted hover:text-foreground",
              )}
            >
              <span className="font-mono text-[10.5px] leading-none">{"{ }"}</span>
            </button>
          }
        />
        {/* 26rem is wider than a 375px viewport, cap it to the screen so the
            reference picker never forces the page to scroll sideways. */}
        <PopoverContent align="end" side="bottom" className="w-[min(26rem,calc(100vw-2rem))] p-0">
          <ReferencePicker
            projectId={projectId}
            excludeToken={row.value}
            onPick={(token) => onChange({ value: insertRefToken(row.value, token) })}
            onClose={() => onPickerOpenChange(false)}
            className="border-0 bg-transparent shadow-none"
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
