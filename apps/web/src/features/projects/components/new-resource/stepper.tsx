// Stepper — ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx.
// Change 4: Tailwind conversion.
import { Fragment } from "react";
import { I } from "./icons";
import { cn } from "@/shared/lib/utils";

export type Step =
  | "kind"
  | "source"
  | "builder"
  | "image"
  | "compose"
  | "version"
  | "networking"
  | "resources"
  | "storage"
  | "variables"
  | "advanced"
  | "review";

export function Stepper({
  steps,
  idx,
  setStep,
}: {
  steps: Array<[Step, string, string]>;
  idx: number;
  setStep: (s: Step) => void;
}) {
  return (
    <div className="flex items-center py-[14px] px-[22px] bg-muted border-b border-border overflow-x-auto">
      {steps.map(([id, lab], i) => {
        return (
          <Fragment key={id}>
            <button
              className={cn(
                "flex items-center gap-2 bg-transparent border-0 py-1 px-[10px] rounded-[5px] shrink-0 text-muted-foreground font-[inherit] text-xs",
                i <= idx ? "cursor-pointer" : "cursor-default",
                i === idx ? "text-foreground font-medium" : "",
                i > idx ? "opacity-50" : "",
              )}
              onClick={() => i <= idx && setStep(id)}
            >
              <span
                className={cn(
                  "w-[18px] h-[18px] rounded-full grid place-items-center text-[10px] font-semibold shrink-0",
                  i <= idx
                    ? "bg-foreground text-background border-0"
                    : "bg-muted text-muted-foreground border border-border",
                )}
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {i < idx ? <I.check width={10} height={10} /> : i + 1}
              </span>
              <span>{lab}</span>
            </button>
            {i < steps.length - 1 && (
              <div className="flex-1 h-px bg-border mx-1.5 min-w-[16px]" />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
