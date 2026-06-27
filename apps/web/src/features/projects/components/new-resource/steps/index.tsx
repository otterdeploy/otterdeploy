import { Fragment } from "react";

import { cn } from "@/shared/lib/utils";

import { I } from "../icons";

export type { Step } from "../schemas";
import type { Step } from "../schemas";

interface StepperProps {
  steps: Array<[Step, string]>;
  idx: number;
  setStep: (s: Step) => void;
  failingSteps?: Set<Step>;
}

export function Stepper({ steps, idx, setStep, failingSteps }: StepperProps) {
  return (
    <div className="flex items-center overflow-x-auto border-b bg-muted px-[22px] py-3.5">
      {steps.map(([id, lab], i) => {
        const isCurrent = i === idx;
        const isPast = i < idx;
        const isFuture = i > idx;
        const failing = failingSteps?.has(id) === true;
        return (
          <Fragment key={id}>
            <button
              type="button"
              onClick={() => !isFuture && setStep(id)}
              disabled={isFuture}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1 text-xs transition-colors",
                isCurrent && "font-medium text-foreground",
                isPast && "cursor-pointer text-muted-foreground hover:text-foreground",
                isFuture && "cursor-default text-muted-foreground opacity-50",
                failing && "text-destructive",
              )}
            >
              <span
                className={cn(
                  "grid size-[18px] place-items-center rounded-full font-mono text-[10px] font-semibold",
                  failing
                    ? "bg-destructive text-destructive-foreground"
                    : isCurrent || isPast
                      ? "bg-foreground text-background"
                      : "border border-border bg-muted text-muted-foreground",
                )}
              >
                {isPast && !failing ? <I.check width={10} height={10} /> : i + 1}
              </span>
              <span>{lab}</span>
            </button>
            {i < steps.length - 1 && <div className="mx-1.5 h-px min-w-4 flex-1 bg-border" />}
          </Fragment>
        );
      })}
    </div>
  );
}

export * from "./kind";
export * from "./source";
export * from "./builder";
export * from "./image";
export * from "./version";
export * from "./networking";
export * from "./resources";
export * from "./storage";
export * from "./variables";
export * from "./review";
export * from "./advanced-db";
