import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";

export const sourceStepSchema = z.object({
  __step: z.literal("source"),
  ...kindFragment,
  ...nameFragment,
  src: z.enum(["github", "gitlab"]),
  repo: z.string().min(1, "Repository is required"),
  branch: z.string().min(1, "Branch is required"),
  root: z.string(),
  autoDeploy: z.boolean(),
  previewBranches: z.boolean(),
});
