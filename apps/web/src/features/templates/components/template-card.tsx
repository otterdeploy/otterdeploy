import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";

import type { StackTemplate } from "../catalog";

import { TEMPLATE_CATEGORIES } from "../catalog";

const CATEGORY_LABEL = new Map(TEMPLATE_CATEGORIES.map((c) => [c.id, c.label]));

export function TemplateCard({
  template,
  onOpen,
}: {
  template: StackTemplate;
  onOpen: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2.5">
        <SvglLogo search={template.logoBrand} fallback={template.name} size={32} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{template.name}</div>
          <div className="text-[11px] text-muted-foreground">
            {CATEGORY_LABEL.get(template.category)}
          </div>
        </div>
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {template.description}
      </p>

      <div className="flex flex-wrap gap-1">
        {template.includes.map((svc) => (
          <span
            key={svc}
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {svc}
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t pt-3">
        <span className="text-[11px] text-muted-foreground">
          {template.includes.length} service{template.includes.length === 1 ? "" : "s"}
        </span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onOpen}>
          Use template
        </Button>
      </div>
    </div>
  );
}
