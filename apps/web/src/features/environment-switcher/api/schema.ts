import * as z from "zod";

export const environmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
});

export type Environment = z.infer<typeof environmentSchema>;
