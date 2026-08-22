/**
 * In-dialog template launcher: the kind step's "From template" sub-view.
 * Search the curated catalog and pick a stack without leaving the wizard.
 * Picking hands off through the same `?new=template&template=<id>` URL the
 * gallery uses: the overlay provider reads it, remounts the wizard on the
 * compose flow prefilled (name + YAML), and the normal review → stage flow
 * takes over. The dialog stays open the whole way.
 */
import { useState } from "react";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";

import type { StackTemplate } from "@/features/templates/catalog";

import { TEMPLATE_CATEGORIES, TEMPLATES } from "@/features/templates/catalog";
import { filterTemplates, sortTemplates } from "@/features/templates/catalog/filter";
import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Input } from "@/shared/components/ui/input";

const CATEGORY_LABEL = new Map(TEMPLATE_CATEGORIES.map((c) => [c.id, c.label]));

export function TemplatePicker() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const visible = sortTemplates(filterTemplates(TEMPLATES, { category: "all", query }), "az");

  // The compose handoff: writing the params is enough, the overlay provider
  // derives the prefill from the URL. `replace` so Back never lands on the
  // intermediate ?new=template state.
  const deploy = (template: StackTemplate) =>
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, new: "template", template: template.id }),
      replace: true,
    });

  return (
    <>
      {/*
       * Pinned to the top of the wizard's scroll area (the `overflow-y-auto`
       * in wizard-chrome.tsx). The catalog is 57 rows and grows: left in the
       * flow, the one control that makes the list shorter scrolls away as soon
       * as you look past the Bs, and narrowing means scrolling back up to
       * reach the field. The live `visible/total` count goes with it, since a
       * match count you can't see while scrolling results isn't telling you
       * anything.
       *
       * The negative margins bleed the bar across the scroller's own p-4 so
       * rows pass cleanly underneath instead of showing through the gap above
       * it; bg-popover is the dialog's surface (see DialogContent).
       */}
      <div className="sticky top-0 z-10 -mx-4 -mt-4 bg-popover px-4 pt-4 pb-3">
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-sm font-semibold">Deploy a template</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {visible.length}/{TEMPLATES.length}
          </span>
        </div>

        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            // The whole point of this view is typing a name: focus lands here.
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter = deploy the top match, so "type name, hit Enter" is the
              // entire gesture.
              if (e.key === "Enter" && visible[0]) deploy(visible[0]);
            }}
            placeholder="Search templates…"
            aria-label="Search templates"
            className="h-8 pl-8"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No templates match "{query}".
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visible.map((template) => (
            <TemplateRow key={template.id} template={template} onDeploy={() => deploy(template)} />
          ))}
        </div>
      )}
    </>
  );
}

function TemplateRow({ template, onDeploy }: { template: StackTemplate; onDeploy: () => void }) {
  return (
    <button
      type="button"
      onClick={onDeploy}
      className="group flex w-full items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-ring"
    >
      <SvglLogo search={template.logoBrand} fallback={template.name} size={26} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] font-semibold">{template.name}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {CATEGORY_LABEL.get(template.category)}
          </span>
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{template.description}</div>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {template.includes.length} service{template.includes.length === 1 ? "" : "s"}
      </span>
      <span className="shrink-0 text-[11px] font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
        Deploy →
      </span>
    </button>
  );
}
