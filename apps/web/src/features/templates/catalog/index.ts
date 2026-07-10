/**
 * Template catalog — the single source the gallery, detail modal, and the
 * wizard-prefill handoff read from. Counts shown in the UI derive from this
 * array; nothing is invented (no install counts / stars / trending).
 */
import type { StackTemplate, TemplateCategoryId } from "./types";

import { ANALYTICS_TEMPLATES } from "./templates-analytics";
import { CMS_TEMPLATES } from "./templates-cms";
import { DATA_TEMPLATES } from "./templates-data";
import { DEV_TEMPLATES } from "./templates-dev";
import { OPS_TEMPLATES } from "./templates-ops";

export type { StackTemplate, TemplateCategoryId, TemplateEnvVar } from "./types";
export { TEMPLATE_CATEGORIES } from "./types";

export const TEMPLATES: StackTemplate[] = [
  ...CMS_TEMPLATES,
  ...ANALYTICS_TEMPLATES,
  ...OPS_TEMPLATES,
  ...DATA_TEMPLATES,
  ...DEV_TEMPLATES,
];

export function getTemplateById(id: string): StackTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Honest per-category counts for the gallery's filter pills. */
export function categoryCounts(templates: StackTemplate[]): Map<TemplateCategoryId, number> {
  const out = new Map<TemplateCategoryId, number>();
  for (const t of templates) out.set(t.category, (out.get(t.category) ?? 0) + 1);
  return out;
}
