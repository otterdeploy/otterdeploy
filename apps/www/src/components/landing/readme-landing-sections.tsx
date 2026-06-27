import { useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import type { TerminalLine } from "./content";

import { FEATURE_CELLS, INSTALL_CMD } from "./content";

// Right-column README body pieces: the copyable install command, the terminal
// code card (with per-line syntax), and the numbered feature grid.

// ── Install command (copy) ─────────────────────────────────────────────────

export function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(INSTALL_CMD);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy install command"
      className="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 text-left transition-colors hover:bg-muted"
    >
      <span className="flex min-w-0 items-center gap-2 font-mono text-[0.8rem]">
        <span className="text-muted-foreground">$</span>
        <span className="truncate text-foreground">{INSTALL_CMD}</span>
      </span>
      {copied ? (
        <HugeiconsIcon icon={Tick02Icon} className="size-4 shrink-0 text-success" />
      ) : (
        <HugeiconsIcon icon={Copy01Icon} className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}

// ── Code block (light card, subtle syntax) ─────────────────────────────────

function CodeLine({ line }: { line: TerminalLine }) {
  switch (line.type) {
    case "blank":
      return <span>&nbsp;</span>;
    case "command": {
      const rest = line.text.startsWith("$ ") ? line.text.slice(2) : line.text;
      return (
        <span className="text-foreground">
          <span className="text-primary">$ </span>
          {rest}
        </span>
      );
    }
    case "comment":
      return <span className="text-muted-foreground/70">{line.text}</span>;
    case "header":
      return (
        <span className="text-foreground/80">
          <span className="text-muted-foreground">→ </span>
          {line.text.replace(/^→\s*/, "")}
        </span>
      );
    case "metric":
      return (
        <span className="text-foreground/90">
          <span className="text-primary">▸ </span>
          {line.text.replace(/^▸\s*/, "")}
        </span>
      );
    case "final":
      return <span className="font-medium text-success">{line.text}</span>;
    case "success": {
      const idx = line.text.indexOf("✓");
      return (
        <span className="text-foreground/90">
          {line.text.slice(0, idx)}
          <span className="text-success">✓</span>
          {line.text.slice(idx + 1)}
        </span>
      );
    }
    default:
      return <span className="text-muted-foreground">{line.text || " "}</span>;
  }
}

export function CodeCard({ title, lines }: { title: string; lines: TerminalLine[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
          <span className="size-2.5 rounded-full bg-border" />
        </span>
        <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{title}</span>
      </div>
      <div className="overflow-x-auto p-4 font-mono text-[0.78rem] leading-relaxed whitespace-pre">
        {lines.map((line, i) => (
          <div key={i}>
            <CodeLine line={line} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Feature grid (numbered hairline cells) ─────────────────────────────────

export function FeatureGrid() {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
        {FEATURE_CELLS.map((cell) => (
          <div key={cell.n} className="flex flex-col bg-background p-5">
            <span className="font-mono text-[11px] text-muted-foreground/70">{cell.n}</span>
            <h3 className="mt-3 text-sm font-semibold tracking-tight text-foreground">
              {cell.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{cell.desc}</p>
            <span className="mt-4 truncate font-mono text-[11px] text-muted-foreground/60">
              {cell.detail}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
