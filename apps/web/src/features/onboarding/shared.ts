import * as z from "zod";

/** A just-created organization, threaded through the wizard's later steps. */
export interface CreatedOrg {
  id: string;
  slug: string;
  name: string;
}

// `.slugify()` alone — derives the slug live as the user types the name.
// Doesn't throw on short/empty input, just normalizes whatever's there.
export const slugifier = z.string().slugify();

/** A name + URL-slug pair, shared by the organization and project steps. */
export const nameAndSlugSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: slugifier
    .min(2, "Slug must be at least 2 characters")
    .max(48, "Slug must be 48 characters or fewer"),
});

/** Flatten TanStack Form's mixed error shape into plain messages. */
export function messages(errors: readonly unknown[]): string[] {
  return errors
    .map((e) => (typeof e === "string" ? e : (e as { message?: string } | undefined)?.message))
    .filter((m): m is string => Boolean(m));
}
