import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import { type SimpleComparison } from "@tanstack/db";

import { z } from "zod";

import { zId } from "@otterdeploy/shared/id";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseCol<T extends z.ZodType>(
  schema: T,
  filters: SimpleComparison[],
  field = "id",
): z.infer<T> {
  // `field` on a SimpleComparison is a path array (e.g. ["projectId"]); match
  // on its leaf segment.
  const expr = filters.find((f) => f.field.at(-1) === field);
  if (!expr) throw new Error(`${field} is required`);
  return schema.parse(expr.value);
}

export const projectIdSchema = zId("project");
