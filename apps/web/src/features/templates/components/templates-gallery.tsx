/**
 * Templates gallery: org-level catalog of curated, deployable compose
 * stacks. Counts, chips, and every card fact derive from the typed catalog
 * (which is itself parser-verified); there are no install counts, stars, or
 * trending lists because we don't measure those.
 *
 * LAYOUT: a slim sticky toolbar (search / sort / result count) over a left
 * category rail beside the card grid.
 *
 * The categories used to be sixteen chips in a segmented control inside the
 * sticky bar. Two problems, both structural. A segmented control is a two-to-
 * five option idiom — the raised active chip says "these are the alternatives,
 * all of them, at a glance" — and sixteen of them stopped reading as one. And
 * because they wrapped, the bar was two or three rows deep depending on window
 * width; being `sticky`, that height was spent at EVERY scroll position, not
 * just at the top. On a 1100px content width it cost ~110px of viewport
 * permanently.
 *
 * A vertical rail costs one narrow column instead, shows all fifteen
 * categories and their counts at once with no wrap and no horizontal scroll,
 * and reflows to nothing but a taller column as labels grow. The toolbar it
 * leaves behind is a single 53px row.
 */
import { useState } from "react";

import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";

import { EmptyCollection, IllustrationPlate } from "@/shared/components/illustrations";
import { Page, PageHeader } from "@/shared/components/page";
import { Button } from "@/shared/components/ui/button";
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

/** Height of the sticky toolbar (py-2.5 + h-8 control + 1px rule). The rail
 *  sticks directly beneath it, and CSS has no way to ask "how tall is my
 *  previous sibling", so the one number lives here next to the classes that
 *  produce it. */
const TOOLBAR_H = "53px";

export function TemplatesGallery({
  orgSlug,
  initialProjectSlug,
}: {
  orgSlug: string;
  initialProjectSlug?: string;
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<TemplateCategoryId | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<TemplateSort>("az");
  const [openId, setOpenId] = useState<string | null>(null);

  const counts = categoryCounts(TEMPLATES);
  const visible = sortTemplates(filterTemplates(TEMPLATES, { category, query }, t), sort);
  const open = openId ? (TEMPLATES.find((t) => t.id === openId) ?? null) : null;

  return (
    <Page>
      <PageHeader
        title={t("nav.templates")}
        description={`${TEMPLATES.length} curated stacks. Pick one, choose a project, review its variables, deploy.`}
      />

      {/*
       * Pinned under the shell header, the same way ProjectTabs is: the catalog
       * runs to 92 cards, so every control that shortens the grid was off-screen
       * within one flick of the wheel.
       *
       * `top-(--header-height)` rather than `top-0`: the page scrolls the
       * document, and the banner + header are one pinned region whose height
       * that variable carries (see the org _shell layout). The gutter bleed
       * makes the bar span the content area so its rule reads as a divider
       * between filters and results instead of a floating box.
       */}
      <div className="sticky top-(--header-height) z-30 -mx-4 flex items-center gap-2 border-b bg-background px-4 py-2.5 sm:-mx-6 sm:px-6">
        <div className="relative max-w-sm flex-1">
          <HugeiconsIcon
            icon={Search01Icon}
            strokeWidth={2}
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("templates.search")}
            aria-label={t("templates.search")}
            className="h-8 pl-8"
          />
        </div>
        <Select items={SORT_ITEMS} value={sort} onValueChange={(v) => setSort(v ?? "az")}>
          <SelectTrigger className="h-8 w-36 shrink-0" aria-label={t("templates.sort")}>
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
        <div className="flex-1" />
        {/* The count is the honest answer to "did my filter do anything", which
            a grid that simply gets shorter doesn't give you. */}
        <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          <span className="font-mono text-foreground tabular-nums">{visible.length}</span> of{" "}
          {TEMPLATES.length}
        </span>
      </div>

      <div className="grid gap-x-6 gap-y-4 md:grid-cols-[168px_minmax(0,1fr)]">
        {/*
         * Below `md` the rail lies down into a scrolling row rather than
         * eating half a phone's width — same buttons, same order, one flex
         * direction apart. Above `md` it sticks just under the toolbar so the
         * categories stay reachable after the first flick, which is the job
         * the old pinned chip bar was doing at three times the height.
         */}
        <nav
          aria-label={t("templates.category")}
          style={{ top: `calc(var(--header-height) + ${TOOLBAR_H})` }}
          className={cn(
            "-mx-4 flex gap-0.5 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            "md:mx-0 md:h-fit md:flex-col md:overflow-visible md:px-0 md:pb-0",
            "md:sticky",
          )}
        >
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
        </nav>

        {/*
         * Container queries, not viewport breakpoints: the grid's width is set
         * by the rail beside it AND by the app sidebar, which the operator can
         * collapse. A `xl:` breakpoint would keep measuring the window and get
         * the column count wrong in exactly the case that matters — sidebar
         * collapsed, plenty of room, still two columns.
         *
         * `@4xl` (896px) puts the third column in at ~295px per card — the
         * width the old three-up grid actually ran at once the app sidebar and
         * page gutters were subtracted, so this is the density the cards were
         * written for rather than a squeeze.
         */}
        <div className="@container">
          {visible.length === 0 ? (
            <NoMatches
              query={query}
              category={category}
              onClearCategory={() => setCategory("all")}
              onClearQuery={() => setQuery("")}
            />
          ) : (
            <div className="grid gap-3 @2xl:grid-cols-2 @4xl:grid-cols-3">
              {visible.map((tpl) => (
                <TemplateCard key={tpl.id} template={tpl} onOpen={() => setOpenId(tpl.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

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
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs whitespace-nowrap transition-colors",
        // Vertical: label left, count right, like any settings list. Horizontal
        // (mobile): they sit side by side and the row scrolls.
        "md:w-full md:justify-between md:gap-2",
        active
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 font-mono text-[10px] tabular-nums opacity-60">{count}</span>
    </button>
  );
}

/**
 * The no-results state, which has to answer WHY nothing matched.
 *
 * "No templates match this filter" was a dead end: with a category selected
 * and a query typed, it never said which of the two excluded everything, and
 * offered no way back. Searching "posti" under CRM returns nothing because
 * Postiz is filed under Automation — a fact the operator has no way to guess
 * from an empty box.
 *
 * So the state names the narrower constraint and counts what the OTHER
 * constraint alone would return, which is the number that tells you which one
 * to drop. Each count is a real filter run over the catalog, not an estimate.
 */
function NoMatches({
  query,
  category,
  onClearCategory,
  onClearQuery,
}: {
  query: string;
  category: TemplateCategoryId | "all";
  onClearCategory: () => void;
  onClearQuery: () => void;
}) {
  const { t } = useTranslation();
  const categoryLabel = TEMPLATE_CATEGORIES.find((c) => c.id === category)?.label ?? null;
  const hasQuery = query.trim() !== "";

  // What each constraint would return on its own, so the copy can point at the
  // one worth dropping instead of telling the operator to "try something else".
  const withoutCategory = hasQuery
    ? filterTemplates(TEMPLATES, { category: "all", query }, t).length
    : TEMPLATES.length;
  const withoutQuery = filterTemplates(TEMPLATES, { category, query: "" }, t).length;

  return (
    <div className="rounded-xl border border-dashed">
      <IllustrationPlate>
        <EmptyCollection />
      </IllustrationPlate>
      <div className="flex flex-col items-center gap-3 px-6 pb-7 text-center">
        <p className="text-sm font-medium">
          {hasQuery && categoryLabel !== null
            ? t("templates.noMatchIn", { query, category: categoryLabel })
            : hasQuery
              ? t("templates.noMatchQuery", { query })
              : t("templates.noMatchCategory", { category: categoryLabel ?? "" })}
        </p>
        <p className="max-w-md text-[13px] text-pretty text-muted-foreground">
          {hasQuery && categoryLabel !== null
            ? t("templates.noMatchHint", { count: withoutCategory, category: categoryLabel })
            : t("templates.noMatchHintPlain")}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {categoryLabel !== null && (
            <Button size="sm" variant="outline" onClick={onClearCategory}>
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3.5" />
              {t("templates.clearCategory", { count: withoutCategory })}
            </Button>
          )}
          {hasQuery && (
            <Button
              size="sm"
              variant={categoryLabel === null ? "outline" : "ghost"}
              className={categoryLabel === null ? undefined : "text-muted-foreground"}
              onClick={onClearQuery}
            >
              {t("templates.clearSearch", { count: withoutQuery })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
