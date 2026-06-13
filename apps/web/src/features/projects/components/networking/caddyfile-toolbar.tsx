/**
 * Toolbar for the Caddyfile viewer: revision badge, in-file find bar
 * (match count + prev/next + clear), and copy-to-clipboard. Kept separate
 * from the viewer shell so each stays small and focused.
 */

import { useState } from "react";
import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  Copy01Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";

export interface CaddyfileToolbarProps {
  revision?: string;
  query: string;
  active: number;
  total: number;
  inputRef: React.RefObject<HTMLInputElement | null>;
  source: string;
  disabled: boolean;
  onQuery: (next: string) => void;
  onStep: (dir: 1 | -1) => void;
}

export function CaddyfileToolbar({
  revision,
  query,
  active,
  total,
  inputRef,
  source,
  disabled,
  onQuery,
  onStep,
}: CaddyfileToolbarProps) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(source).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
      <span className="font-mono text-[11px] text-muted-foreground">Caddyfile</span>
      {revision ? (
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/80">
          rev {revision}
        </span>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <div className="flex h-7 items-center gap-1.5 rounded-lg border bg-background px-2">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="size-3.5 text-muted-foreground"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onStep(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                onQuery("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Find in config"
            spellCheck={false}
            className="w-36 bg-transparent font-mono text-[12px] outline-none placeholder:text-muted-foreground/60"
          />
          {query ? (
            <>
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                {total === 0 ? "0/0" : `${active + 1}/${total}`}
              </span>
              <NavButton label="Previous match" icon={ArrowUp01Icon} disabled={total === 0} onClick={() => onStep(-1)} />
              <NavButton label="Next match" icon={ArrowDown01Icon} disabled={total === 0} onClick={() => onStep(1)} />
              <NavButton
                label="Clear search"
                icon={Cancel01Icon}
                onClick={() => {
                  onQuery("");
                  inputRef.current?.focus();
                }}
              />
            </>
          ) : null}
        </div>

        <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={copy} disabled={disabled}>
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function NavButton({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40"
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5" />
    </button>
  );
}
