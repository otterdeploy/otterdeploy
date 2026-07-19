/**
 * Editable YAML surface — a textarea with a synchronized line-number
 * gutter on the left. Plain monospace, no syntax highlighting in edit
 * mode (the highlighted YamlView is the read-only counterpart). The
 * gutter scrolls in lockstep with the textarea via a shared scrollTop
 * handler so long files don't drift.
 */

import { useEffect, useRef } from "react";

import { cn } from "@/shared/lib/utils";

export interface YamlEditorProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  className?: string;
}

export function YamlEditor({ value, onChange, onSubmit, disabled, className }: YamlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = value.split("\n");
  const gutterWidth = String(lines.length).length;

  // Sync the gutter's scrollTop to the textarea on every render so the
  // numbers track multi-line edits that shift the visible window.
  useEffect(() => {
    const ta = textareaRef.current;
    const gut = gutterRef.current;
    if (!ta || !gut) return;
    const handler = () => {
      gut.scrollTop = ta.scrollTop;
    };
    ta.addEventListener("scroll", handler);
    return () => ta.removeEventListener("scroll", handler);
  }, []);

  return (
    <div className={cn("relative flex h-full overflow-hidden", className)}>
      <div
        ref={gutterRef}
        aria-hidden
        className="overflow-hidden bg-background/40 py-2 pr-2 pl-3 text-right font-mono text-[12px] leading-[1.55] text-muted-foreground/40 tabular-nums select-none"
      >
        {lines.map((_, i) => (
          <div key={i}>{String(i + 1).padStart(gutterWidth, " ")}</div>
        ))}
      </div>
      <textarea
        ref={textareaRef}
        aria-label="YAML editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            onSubmit?.();
          }
        }}
        spellCheck={false}
        disabled={disabled}
        className="size-full resize-none border-0 bg-transparent px-3 py-2 font-mono text-[12px] leading-[1.55] text-foreground/90 outline-none disabled:opacity-60"
      />
    </div>
  );
}
