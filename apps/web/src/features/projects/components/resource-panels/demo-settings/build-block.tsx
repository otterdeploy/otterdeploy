import { useState } from "react";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import { Field, SettingsBlock, SubLabel } from "./atoms";
import { BUILDERS } from "./constants";

export function BuildBlock() {
  const [builder, setBuilder] =
    useState<(typeof BUILDERS)[number]["id"]>("railpack");

  return (
    <SettingsBlock title="Build">
      <SubLabel>Builder</SubLabel>
      <div className="grid grid-cols-2 gap-2.5">
        {BUILDERS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBuilder(b.id)}
            className={cn(
              "rounded-lg border bg-card p-3 text-left transition-colors hover:border-ring",
              builder === b.id
                ? "border-primary bg-primary/5"
                : "border-border/60",
            )}
          >
            <div className="text-[13px] font-semibold">{b.name}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{b.sub}</div>
          </button>
        ))}
      </div>

      <SubLabel className="mt-5">Source</SubLabel>
      <Field label="Root directory" hint="Path inside the repo to build from">
        <Input className="h-8 font-mono" defaultValue="./" />
      </Field>

      <SubLabel className="mt-5">Commands</SubLabel>
      <Field
        label="Install command"
        hint="Inferred — pnpm install / pip install / cargo fetch"
      >
        <Input className="h-8 font-mono" defaultValue="auto-detected" />
      </Field>
      <Field
        label="Build command"
        hint="Inferred — pnpm build / cargo build --release"
      >
        <Input className="h-8 font-mono" defaultValue="auto-detected" />
      </Field>
      <Field
        label="Start command"
        hint="Override what runs when the container starts"
      >
        <Input className="h-8 font-mono" defaultValue="node dist/index.js" />
      </Field>

      <SubLabel className="mt-5">Build args</SubLabel>
      <div className="flex items-center gap-2">
        <Input className="h-8 w-44 font-mono" defaultValue="NODE_VERSION" />
        <Input className="h-8 flex-1 font-mono" defaultValue="22" />
        <Button variant="ghost" size="icon-sm" aria-label="Remove arg">
          ×
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Build args are passed to{" "}
        <span className="font-mono text-foreground/80">docker build --build-arg</span>
        . They aren't available at runtime — use Variables for that.
      </p>
    </SettingsBlock>
  );
}
