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
import { useTranslation } from "react-i18next";

import type { StackTemplate } from "@/features/templates/catalog";

import { TEMPLATE_CATEGORIES, TEMPLATES } from "@/features/templates/catalog";
import { filterTemplates, sortTemplates } from "@/features/templates/catalog/filter";
import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Input } from "@/shared/components/ui/input";

const CATEGORY_LABEL = new Map(TEMPLATE_CATEGORIES.map((c) => [c.id, c.label]));

export function TemplatePicker() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const visible = sortTemplates(filterTemplates(TEMPLATES, { category: "all", query }, t), "az");

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
    /*
     * Two regions: a header that never moves, and the results scrolling under
     * it. The catalog is 57 rows and grows, so leaving the search field in the
     * flow put the one control that makes the list shorter off-screen as soon
     * as you looked past the Bs — and narrowing meant scrolling back up to
     * reach it. The live `visible/total` count stays with the field for the
     * same reason: a match count you can't see while scrolling matches isn't
     * reporting anything.
     *
     * The header is OUTSIDE the scroll container rather than `sticky` inside
     * it. See the note in wizard-chrome.tsx: a sticky bar pins to the
     * scroller's content box, which left a padding-sized band above it that
     * rows were still painted into. Nothing can be painted in this header's
     * band because the scrollport starts below it.
     */
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        {/*
         * Label and count ride ON the search row rather than above it. Stacked,
         * they cost a whole line of a bounded dialog to repeat what the dialog
         * title and the stepper have already said, and pushed the first result
         * further from the field that filters it.
         */}
        <div className="flex shrink-0 items-baseline gap-1.5">
          <span className="text-sm font-semibold">{t("templates.pickerTitle")}</span>
          <span className="font-mono text-[10px] text-muted-foreground">
            {visible.length}/{TEMPLATES.length}
          </span>
        </div>

        <div className="relative min-w-0 flex-1">
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
            placeholder={t("templates.searchPlaceholder")}
            aria-label={t("templates.searchLabel")}
            className="h-8 pl-8"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {visible.length === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            {t("templates.noMatch", { query })}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {visible.map((template) => (
              <TemplateRow
                key={template.id}
                template={template}
                onDeploy={() => deploy(template)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateRow({ template, onDeploy }: { template: StackTemplate; onDeploy: () => void }) {
  const { t } = useTranslation();
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
        <div className="truncate text-[11px] text-muted-foreground">
          {t(template.descriptionKey)}
        </div>
      </div>
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
        {t("templates.serviceCount", { count: template.includes.length })}
      </span>
      <span className="shrink-0 text-[11px] font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
        {t("templates.deployAction")}
      </span>
    </button>
  );
}
