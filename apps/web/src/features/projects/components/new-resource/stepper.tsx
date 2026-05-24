// Stepper — ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx.
import { Fragment } from "react";
import { I } from "./icons";

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
    <div
      className="os-row"
      style={{
        padding: "14px 22px",
        gap: 0,
        background: "var(--muted)",
        borderBottom: "1px solid var(--border)",
        overflowX: "auto",
      }}
    >
      {steps.map(([id, lab], i) => {
        return (
          <Fragment key={id}>
            <button
              className="os-row os-gap-2"
              onClick={() => i <= idx && setStep(id)}
              style={{
                background: "transparent",
                border: 0,
                cursor: i <= idx ? "pointer" : "default",
                padding: "4px 10px",
                borderRadius: 5,
                flexShrink: 0,
                color:
                  i === idx
                    ? "var(--foreground)"
                    : i < idx
                      ? "var(--muted-foreground)"
                      : "var(--muted-foreground)",
                fontWeight: i === idx ? 500 : 400,
                fontSize: 12,
                opacity: i > idx ? 0.5 : 1,
                fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: i <= idx ? "var(--foreground)" : "var(--muted)",
                  color: i <= idx ? "var(--background)" : "var(--muted-foreground)",
                  border: i > idx ? "1px solid var(--border)" : "none",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                }}
              >
                {i < idx ? <I.check width={10} height={10} /> : i + 1}
              </span>
              <span>{lab}</span>
            </button>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: "var(--border)",
                  margin: "0 6px",
                  minWidth: 16,
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
