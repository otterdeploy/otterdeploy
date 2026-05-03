import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveSection } from "../hooks/use-active-section";
import type { SettingsSection } from "../types";
import { TocSidebar } from "./toc-sidebar";

const sections: ReadonlyArray<SettingsSection> = [
  { id: "general", label: "General" },
  { id: "identity", label: "Identity" },
  { id: "integrations", label: "Integrations" },
  { id: "billing", label: "Billing" },
  { id: "update-channel", label: "Update channel" },
  { id: "danger", label: "Danger zone" },
];

export function SettingsPage() {
  const { activeId, setActive } = useActiveSection(sections);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = visible[0].target.getAttribute("data-section-id");
          if (id) setActive(id);
        }
      },
      { rootMargin: "-30% 0px -50% 0px", threshold: [0, 1] },
    );

    sections.forEach((section) => {
      const element = root.querySelector(`[data-section-id="${section.id}"]`);
      if (element) observer.observe(element);
    });

    return () => observer.disconnect();
  }, [setActive]);

  const handleJump = (id: string) => {
    const element = containerRef.current?.querySelector(`[data-section-id="${id}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid grid-cols-[1fr_180px] gap-8 p-6">
      <div ref={containerRef} className="grid gap-10">
        <h1 className="text-2xl font-semibold tracking-tight">Workspace settings</h1>
        <Section id="general" title="General">
          <Field>
            <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
            <Input id="ws-name" defaultValue="otterstack" disabled />
            <FieldDescription>Persistence ships when the workspace settings API lands in Plan 6.</FieldDescription>
          </Field>
          <SaveButton />
        </Section>
        <Section id="identity" title="Identity & SSO">
          <p className="text-sm text-muted-foreground">SAML, OIDC, and SCIM provisioning configuration ships in Plan 6.</p>
        </Section>
        <Section id="integrations" title="Integrations">
          <p className="text-sm text-muted-foreground">GitHub, Resend, Inngest, Polar — connection management ships in Plan 6.</p>
        </Section>
        <Section id="billing" title="Billing">
          <p className="text-sm text-muted-foreground">Plan + invoices via Polar ships in Plan 6.</p>
        </Section>
        <Section id="update-channel" title="Update channel">
          <p className="text-sm text-muted-foreground">Stable / beta channel selector for self-hosted updates ships in Plan 6.</p>
        </Section>
        <Section id="danger" title="Danger zone">
          <Tooltip>
            <TooltipTrigger render={<Button variant="destructive" disabled>Delete workspace</Button>} />
            <TooltipPopup>Workspace deletion ships in Plan 6</TooltipPopup>
          </Tooltip>
        </Section>
      </div>
      <TocSidebar sections={sections} activeId={activeId} onJump={handleJump} />
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section data-section-id={id} className="grid gap-4 scroll-mt-4">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="grid gap-4 rounded-xl border bg-card p-5">{children}</div>
    </section>
  );
}

function SaveButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button size="sm" className="w-fit" disabled>
            Save
          </Button>
        }
      />
      <TooltipPopup>Settings API ships in Plan 6</TooltipPopup>
    </Tooltip>
  );
}
