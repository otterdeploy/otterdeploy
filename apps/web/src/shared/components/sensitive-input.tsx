import type { ComponentProps } from "react";

import { ViewIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { useRevealState } from "@/shared/hooks/use-reveal-state";
import { cn } from "@/shared/lib/utils";

/**
 * SensitiveValue's rule for a field being typed into: masked by default, with the
 * eye to check what was typed. Masked with `-webkit-text-security` rather
 * than `type="password"`, so a browser does not offer to save it as one.
 */
export function SensitiveInput({
  label,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "type"> & { label: string }) {
  const [open, setOpen] = useRevealState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type="text"
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        className={cn("pr-9", !open && "[-webkit-text-security:disc]", className)}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        aria-pressed={open}
        aria-label={open ? `Hide ${label}` : `Reveal ${label}`}
        title={open ? "Hide" : "Reveal"}
        onClick={() => setOpen((v) => !v)}
      >
        <HugeiconsIcon icon={open ? ViewOffIcon : ViewIcon} strokeWidth={2} className="size-3.5" />
      </Button>
    </div>
  );
}
