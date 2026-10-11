/**
 * The install command, shown once. The one surface in the dialog with focal
 * contrast, because it is the thing the user came to copy. It uses the app's
 * log surface (`bg-terminal`) rather than inventing a dark panel.
 *
 * The token stays masked until revealed; Copy always writes the real command.
 */

import { useState } from "react";

import { Copy01Icon, Tick02Icon, ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { copyToClipboard } from "@/shared/lib/clipboard";

import { maskToken } from "./join-command";

export function CommandBlock({ command, token }: { command: string; token: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [before = "", after = ""] = command.split(token);

  const copy = () => {
    void copyToClipboard(command).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <figure className="flex flex-col rounded-lg border bg-terminal text-terminal-foreground">
      <figcaption className="flex min-h-9 items-center gap-2 py-1.5 pr-1.5 pl-3.5">
        <span className="min-w-0 flex-1 text-sm text-terminal-foreground/70">
          Run as root on the new server (Docker installed)
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={revealed ? "Hide token" : "Show token"}
          aria-pressed={revealed}
          onClick={() => setRevealed((v) => !v)}
        >
          <HugeiconsIcon icon={revealed ? ViewOffIcon : ViewIcon} strokeWidth={2} />
        </Button>
        <Button
          type="button"
          size="xs"
          variant={copied ? "outline" : "default"}
          onClick={copy}
          aria-live="polite"
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} strokeWidth={2} />
          {copied ? "Copied" : "Copy"}
        </Button>
      </figcaption>
      {/* Never wraps mid-token or mid-URL: a long control-plane address or a
          revealed token scrolls sideways instead. */}
      <pre className="overflow-x-auto px-3.5 pt-1 pb-3.5 font-mono text-[12px] leading-relaxed">
        <code>
          {before}
          <span className="rounded-sm bg-foreground/[0.06] px-1 py-px">
            {revealed ? token : maskToken(token)}
          </span>
          {after}
        </code>
      </pre>
    </figure>
  );
}
