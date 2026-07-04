import type { ProjectSlug } from "@otterdeploy/shared/id";

import { useState } from "react";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";

import { cn } from "@/shared/lib/utils";

import type { CreatedOrg } from "./shared";

import { DomainStep } from "./domain-step";
import { OrganizationStep } from "./organization-step";
import { ProjectStep } from "./project-step";
import { WizardShell } from "./wizard-shell";

type StepId = "organization" | "domain" | "project";

const STEPS: { id: StepId; title: string; hint: string }[] = [
  { id: "organization", title: "Organization", hint: "Your workspace" },
  { id: "domain", title: "Base domain", hint: "Where services live" },
  { id: "project", title: "First project", hint: "Start deploying" },
];

/**
 * First-run setup wizard. Walks a brand-new user from signup to a project they
 * can deploy into: create an organization, set a base domain (skippable), then
 * create a first project. Every step writes through a real API — nothing here
 * is staged or faked.
 *
 * `initialOrg` resumes the flow past step 1 when the user already has an
 * organization (e.g. a mid-wizard refresh after the org was created).
 */
export function SetupWizard({ initialOrg = null }: { initialOrg?: CreatedOrg | null }) {
  const navigate = useNavigate();
  const [org, setOrg] = useState<CreatedOrg | null>(initialOrg);
  const [step, setStep] = useState<StepId>(initialOrg ? "domain" : "organization");

  const activeIndex = STEPS.findIndex((s) => s.id === step);

  function finishToProject(projectSlug: string) {
    if (!org) return;
    void navigate({
      to: "/$orgSlug/$projectSlug",
      params: { orgSlug: org.slug, projectSlug: projectSlug as ProjectSlug },
    });
  }

  function finishToOrg() {
    if (!org) return;
    void navigate({ to: "/$orgSlug", params: { orgSlug: org.slug } });
  }

  return (
    <WizardShell>
      <div className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10 md:grid md:grid-cols-[13.5rem_1fr]">
        {/* ─── Stepper rail (md+) ─── */}
        <nav
          aria-label="Setup progress"
          className="hidden border-r border-border bg-foreground/[0.015] p-6 md:block"
        >
          <p className="mb-5 font-mono text-[10px] tracking-[0.08em] text-muted-foreground/70 uppercase">
            Set up otterdeploy
          </p>
          <ol className="flex flex-col">
            {STEPS.map((s, i) => {
              const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "upcoming";
              const last = i === STEPS.length - 1;
              return (
                <li key={s.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition-colors",
                        state === "active" && "bg-primary text-primary-foreground",
                        state === "done" &&
                          "bg-foreground/[0.04] text-foreground ring-1 ring-foreground/15",
                        state === "upcoming" && "text-muted-foreground ring-1 ring-foreground/10",
                      )}
                      aria-current={state === "active" ? "step" : undefined}
                    >
                      {state === "done" ? (
                        <HugeiconsIcon icon={Tick02Icon} strokeWidth={2.5} className="size-3.5" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {last ? null : (
                      <span
                        className={cn(
                          "my-1 w-px flex-1",
                          i < activeIndex ? "bg-foreground/20" : "bg-border",
                        )}
                      />
                    )}
                  </div>
                  <div className={cn("pb-6", last && "pb-0")}>
                    <div
                      className={cn(
                        "text-sm leading-6 font-medium",
                        state === "upcoming" ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {s.title}
                    </div>
                    <div className="text-xs text-muted-foreground">{s.hint}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </nav>

        {/* ─── Step content ─── */}
        <div className="p-6 sm:p-8">
          {/* Compact progress for small screens */}
          <div className="mb-6 flex items-center gap-3 md:hidden">
            <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
              Step {activeIndex + 1} of {STEPS.length}
            </span>
            <div className="flex flex-1 items-center gap-1.5">
              {STEPS.map((s, i) => (
                <span
                  key={s.id}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors",
                    i <= activeIndex ? "bg-primary" : "bg-border",
                  )}
                />
              ))}
            </div>
          </div>

          {step === "organization" || !org ? (
            <OrganizationStep
              onComplete={(created) => {
                setOrg(created);
                setStep("domain");
              }}
            />
          ) : step === "domain" ? (
            <DomainStep
              organizationId={org.id}
              onComplete={() => setStep("project")}
              onSkip={() => setStep("project")}
            />
          ) : (
            <ProjectStep onCreated={finishToProject} onSkip={finishToOrg} />
          )}
        </div>
      </div>
    </WizardShell>
  );
}
