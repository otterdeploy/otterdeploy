import * as z from "zod";

// Fields that must already be valid by the time the wizard reaches each step.
// Re-exported as a "fragment object" so step arms can spread it.
export const nameFragment = {
  name: z
    .string()
    .slugify()
    .min(2, "Name must be at least 2 characters")
    .max(48, "Name must be 48 characters or fewer"),
};

export const kindFragment = {
  kindId: z.string().min(1, "Select a resource type"),
};
