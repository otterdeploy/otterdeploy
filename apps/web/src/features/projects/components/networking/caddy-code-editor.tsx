/**
 * Editable Caddyfile surface: a transparent <textarea> stacked over a
 * syntax-highlighted <pre>, both sharing identical font metrics and padding
 * so the caret lands exactly on the colored glyphs beneath it. Reuses the
 * same dependency-free tokenizer (`buildModel`) as the read-only viewer, adds
 * a line-number gutter and tab-to-indent. Scroll is mirrored from the
 * textarea (the only scrollable layer the user touches) onto the highlight
 * layer and gutter so all three stay locked together.
 */

import { Fragment, useEffect, useRef } from "react";

import {
  buildModel,
  KIND_CLASS,
} from "@/features/projects/components/networking/caddyfile-highlight";
import { cn } from "@/shared/lib/utils";

export interface CaddyCodeEditorProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  spellCheck?: boolean;
  className?: string;
  /** Tab key inserts this string (default: a single tab). */
  indent?: string;
}

// Shared text metrics — the highlight layer, textarea, and gutter MUST agree
// on every property that affects glyph position, or the caret drifts.
const TEXT_METRICS = "font-mono text-[12.5px] leading-[1.6]";
const PAD_Y = "py-2.5";
const PAD_X = "px-3";

export function CaddyCodeEditor({
  value,
  onValueChange,
  placeholder,
  spellCheck = false,
  className,
  indent = "\t",
}: CaddyCodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const lines = value.length === 0 ? null : buildModel(value, "").lines;
  const lineCount = value.length === 0 ? 1 : value.split("\n").length;
  const gutterDigits = String(lineCount).length;

  // Mirror the textarea's scroll onto the (non-interactive) highlight + gutter.
  const syncScroll = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop;
      highlightRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  // Re-sync after value changes (programmatic edits can shift scrollHeight).
  useEffect(syncScroll, [value]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const { selectionStart, selectionEnd } = ta;
    const next = value.slice(0, selectionStart) + indent + value.slice(selectionEnd);
    onValueChange(next);
    // Restore the caret just past the inserted indent on the next frame.
    requestAnimationFrame(() => {
      const pos = selectionStart + indent.length;
      ta.selectionStart = ta.selectionEnd = pos;
    });
  };

  return (
    <div
      className={cn(
        "relative flex overflow-hidden rounded-lg border bg-muted/20 focus-within:ring-1 focus-within:ring-ring",
        className,
      )}
    >
      {/* Gutter — vertical-scroll only, mirrored from the textarea. */}
      <div
        ref={gutterRef}
        aria-hidden
        className={cn(
          "flex-none overflow-hidden border-r border-border/60 bg-muted/30 text-right text-muted-foreground/40 tabular-nums select-none",
          TEXT_METRICS,
          PAD_Y,
        )}
        style={{ width: `${gutterDigits + 2}ch`, paddingInline: "0.5ch" }}
      >
        {Array.from({ length: lineCount }).map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>

      {/* Text stack: highlighted <pre> underneath, transparent <textarea> on top. */}
      <div className="relative min-w-0 flex-1">
        <pre
          ref={highlightRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 m-0 overflow-auto whitespace-pre",
            TEXT_METRICS,
            PAD_Y,
            PAD_X,
          )}
        >
          {lines === null ? (
            <span className="text-muted-foreground/45">{placeholder}</span>
          ) : (
            // One continuous text flow (not per-line <div>s) so it mirrors the
            // textarea's layout exactly — empty lines keep their height and the
            // caret never drifts. A trailing space on the final line preserves
            // its box even when empty.
            lines.map((segs, idx) => (
              <Fragment key={idx}>
                {segs.map((seg, i) => (
                  <span key={i} className={KIND_CLASS[seg.kind]}>
                    {seg.text}
                  </span>
                ))}
                {idx < lines.length - 1 ? "\n" : " "}
              </Fragment>
            ))
          )}
        </pre>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          spellCheck={spellCheck}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          className={cn(
            "absolute inset-0 m-0 size-full resize-none overflow-auto border-0 bg-transparent whitespace-pre text-transparent caret-foreground outline-none",
            "selection:bg-primary/25",
            TEXT_METRICS,
            PAD_Y,
            PAD_X,
          )}
        />
      </div>
    </div>
  );
}
