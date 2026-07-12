import { createFormHookContexts } from "@tanstack/react-form";

// Leaf module: the raw form/field contexts live here so that field components
// can read them without importing `form-context.ts` (which imports the field
// components back — that edge is what created the import cycle). Both sides now
// depend on this module instead of on each other.
export const { fieldContext, formContext, useFieldContext, useFormContext } =
  createFormHookContexts();
