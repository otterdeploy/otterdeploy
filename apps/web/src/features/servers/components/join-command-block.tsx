import { useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { copyToClipboard } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";

export function JoinCommandBlock({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void copyToClipboard(command).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative rounded-md border bg-muted/50 p-3 pr-11 font-mono text-[12px] leading-relaxed text-foreground/90">
      <code className="block break-all whitespace-pre-wrap">{command}</code>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy command"}
        className={cn("absolute top-2 right-2 size-7 bg-background", copied && "text-success")}
      >
        <HugeiconsIcon
          icon={copied ? Tick02Icon : Copy01Icon}
          strokeWidth={2}
          className="size-3.5"
        />
      </Button>
    </div>
  );
}
