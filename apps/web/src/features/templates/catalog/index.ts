/**
 * Template catalog: the single source the gallery, detail modal, and the
 * wizard-prefill handoff read from. Counts shown in the UI derive from this
 * array; nothing is invented (no install counts / stars / trending).
 */
import type { StackTemplate, TemplateCategoryId } from "./types";

import { AI_TEMPLATES } from "./templates-ai";
import { AI_APPS_TEMPLATES } from "./templates-ai-apps";
import { ANALYTICS_TEMPLATES } from "./templates-analytics";
import { APPSTACK_TEMPLATES } from "./templates-appstack";
import { BILLING_TEMPLATES } from "./templates-billing";
import { CMS_TEMPLATES } from "./templates-cms";
import { CRM_TEMPLATES } from "./templates-crm";
import { DATA_TEMPLATES } from "./templates-data";
import { DEV_TEMPLATES } from "./templates-dev";
import { DEVKIT_TEMPLATES } from "./templates-devkit";
import { DEVTOOLS_TEMPLATES } from "./templates-devtools";
import { MESH_TEMPLATES } from "./templates-mesh";
import { OPS_TEMPLATES } from "./templates-ops";
import { PLATFORM_ID_TEMPLATES } from "./templates-platform-id";
import { PLATFORM_OPS_TEMPLATES } from "./templates-platform-ops";
import { PUBLISHING_TEMPLATES } from "./templates-publishing";
import { SERVICES_TEMPLATES } from "./templates-services";

export type { StackTemplate, TemplateCategoryId, TemplateEnvVar } from "./types";
export { TEMPLATE_CATEGORIES } from "./types";

export const TEMPLATES: StackTemplate[] = [
  ...CMS_TEMPLATES,
  ...CRM_TEMPLATES,
  ...ANALYTICS_TEMPLATES,
  ...AI_TEMPLATES,
  ...AI_APPS_TEMPLATES,
  ...OPS_TEMPLATES,
  ...PLATFORM_OPS_TEMPLATES,
  ...PLATFORM_ID_TEMPLATES,
  ...MESH_TEMPLATES,
  ...DATA_TEMPLATES,
  ...DEV_TEMPLATES,
  ...DEVTOOLS_TEMPLATES,
  ...DEVKIT_TEMPLATES,
  ...BILLING_TEMPLATES,
  ...APPSTACK_TEMPLATES,
  ...PUBLISHING_TEMPLATES,
  ...SERVICES_TEMPLATES,
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
