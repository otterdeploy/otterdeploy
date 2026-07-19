/**
 * Templates gallery — org-level catalog of curated, deployable compose
 * stacks. Counts, chips, and every card fact derive from the typed catalog
 * (which is itself parser-verified); there are no install counts, stars, or
 * trending lists because we don't measure those.
 */
import { useState } from "react";

import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Page, PageHeader } from "@/shared/components/page";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/lib/utils";

import type { TemplateCategoryId } from "../catalog";
import type { TemplateSort } from "../catalog/filter";

import { categoryCounts, TEMPLATE_CATEGORIES, TEMPLATES } from "../catalog";
import { filterTemplates, sortTemplates } from "../catalog/filter";
import { TemplateCard } from "./template-card";
import { TemplateDetailDialog } from "./template-detail-dialog";

const SORT_ITEMS: { label: string; value: TemplateSort }[] = [
  { label: "A → Z", value: "az" },
  { label: "By category", value: "category" },
];

export function TemplatesGallery({
  orgSlug,
  initialProjectSlug,
}: {
  orgSlug: string;
  initialProjectSlug?: string;
}) {
  const [category, setCategory] = useState<TemplateCategoryId | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TemplateSort>("az");
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = categoryCounts(TEMPLATES);
  const visible = sortTemplates(filterTemplates(TEMPLATES, { category, query }), sort);
  const open = openId ? (TEMPLATES.find((t) => t.id === openId) ?? null) : null;

  return (
    <Page>
      <PageHeader
        title="Templates"
        description={`${TEMPLATES.length} curated stacks — pick one, choose a project, review its variables, deploy.`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex w-fit flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-0.5">
          <CategoryChip
            active={category === "all"}
            onClick={() => setCategory("all")}
            label="All"
            count={TEMPLATES.length}
          />
          {TEMPLATE_CATEGORIES.map((c) => (
            <CategoryChip
              key={c.id}
              active={category === c.id}
              onClick={() => setCategory(c.id)}
              label={c.label}
              count={counts.get(c.id) ?? 0}
            />
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates"
            aria-label="Search templates"
            className="h-8 w-52 pl-8"
          />
        </div>
        <Select items={SORT_ITEMS} value={sort} onValueChange={(v) => setSort(v ?? "az")}>
          <SelectTrigger className="h-8 w-36" aria-label="Sort templates">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_ITEMS.map((it) => (
              <SelectItem key={it.value} value={it.value}>
                {it.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No templates match this filter.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((t) => (
            <TemplateCard key={t.id} template={t} onOpen={() => setOpenId(t.id)} />
          ))}
        </div>
      )}

      <TemplateDetailDialog
        template={open}
        orgSlug={orgSlug}
        initialProjectSlug={initialProjectSlug}
        onClose={() => setOpenId(null)}
      />
    </Page>
  );
}

function CategoryChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}
