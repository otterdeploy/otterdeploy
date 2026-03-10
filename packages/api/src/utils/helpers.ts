import { createId as cuid } from "@paralleldrive/cuid2";

export const createId = cuid;

export function slugify(name: string) {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);

  return normalized || "project";
}

export async function generateUniqueSlug(
  base: string,
  checkFn: (slug: string) => Promise<boolean>,
) {
  let candidate = slugify(base);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const exists = await checkFn(candidate);
    if (!exists) return candidate;
    candidate = `${slugify(base)}-${Math.floor(Math.random() * 10_000)}`;
  }

  throw new Error("Could not generate a unique slug");
}

export const ROLE_HIERARCHY = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
} as const;

export type OrgRole = keyof typeof ROLE_HIERARCHY;

export function hasMinRole(actual: string, required: OrgRole): boolean {
  const actualLevel = ROLE_HIERARCHY[actual as OrgRole];
  const requiredLevel = ROLE_HIERARCHY[required];
  if (actualLevel === undefined || requiredLevel === undefined) return false;
  return actualLevel >= requiredLevel;
}

export function toISOString(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export function paginationMeta(page: number, pageSize: number, total: number) {
  return {
    pagination: {
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      total,
    },
  };
}
