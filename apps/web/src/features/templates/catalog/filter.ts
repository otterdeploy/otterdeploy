/**
 * Pure filter/sort helpers for the templates gallery — kept out of the
 * component so they're unit-testable (see filter.test.ts).
 */
import type { StackTemplate, TemplateCategoryId } from "./types";

import { TEMPLATE_CATEGORIES } from "./types";

export type TemplateSort = "az" | "category";

export interface TemplateFilter {
  category: TemplateCategoryId | "all";
  query: string;
}

/** Category pill + free-text search. The query matches name, description, and
 *  included service names, case-insensitively. */
export function filterTemplates(
  templates: StackTemplate[],
  { category, query }: TemplateFilter,
): StackTemplate[] {
  const needle = query.trim().toLowerCase();
  return templates.filter((t) => {
    if (category !== "all" && t.category !== category) return false;
    if (!needle) return true;
    return (
      t.name.toLowerCase().includes(needle) ||
      t.description.toLowerCase().includes(needle) ||
      t.includes.some((s) => s.toLowerCase().includes(needle))
    );
  });
}

const CATEGORY_ORDER = new Map(TEMPLATE_CATEGORIES.map((c, i) => [c.id, i]));

/** A→Z, or category order (as declared in TEMPLATE_CATEGORIES) then A→Z. */
export function sortTemplates(templates: StackTemplate[], sort: TemplateSort): StackTemplate[] {
  const az = (a: StackTemplate, b: StackTemplate) => a.name.localeCompare(b.name);
  if (sort === "az") return templates.toSorted(az);
  return templates.toSorted(
    (a, b) =>
      (CATEGORY_ORDER.get(a.category) ?? 0) - (CATEGORY_ORDER.get(b.category) ?? 0) || az(a, b),
  );
}
