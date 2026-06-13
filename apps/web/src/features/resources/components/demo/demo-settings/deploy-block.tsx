import { useState } from "react";

import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";

import { Field, SettingsBlock } from "./atoms";
import { DEPLOY_STRATEGIES } from "./constants";

export function DeployBlock() {
  const [strategy, setStrategy] =
    useState<(typeof DEPLOY_STRATEGIES)[number]["id"]>("rolling");

  return (
    <SettingsBlock title="Deploy">
      <div className="grid grid-cols-2 gap-2.5">
        {DEPLOY_STRATEGIES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStrategy(s.id)}
            className={cn(
              "rounded-lg border bg-card p-3 text-left transition-colors hover:border-ring",
              strategy === s.id
                ? "border-primary bg-primary/5"
                : "border-border/60",
            )}
          >
            <div className="text-[13px] font-semibold">{s.name}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{s.sub}</div>
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Field label="Parallelism" hint="Replicas updated together">
          <Input className="h-8 font-mono" defaultValue="1" />
        </Field>
        <Field label="Max unavailable">
          <Input className="h-8 font-mono" defaultValue="0" />
        </Field>
        <Field label="Drain (s)" hint="Time given to graceful shutdown">
          <Input className="h-8 font-mono" defaultValue="30" />
        </Field>
      </div>
    </SettingsBlock>
  );
}
