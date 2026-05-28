import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";

export const sourceStepSchema = z.object({
  __step: z.literal("source"),
  ...kindFragment,
  ...nameFragment,
  src: z.enum(["github", "gitlab"]),
  // repo + branch aren't validated here: the source binding lives on
  // the project (set via the BindingSummary / Settings → Build) and the
  // create handler reads it from there, not from this form. Validating
  // them in the wizard was a vestige from the per-service picker.
  repo: z.string(),
  branch: z.string(),
  root: z.string(),
  autoDeploy: z.boolean(),
  previewBranches: z.boolean(),
});
