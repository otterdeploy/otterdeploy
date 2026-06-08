import * as z from "zod";
import { kindFragment, nameFragment } from "./_base";

export const sourceStepSchema = z.object({
  __step: z.literal("source"),
  ...kindFragment,
  ...nameFragment,
  src: z.enum(["github", "gitlab"]),
  // A source-based service can't proceed without a bound repo — the step
  // gates Continue on this. Binding happens in-wizard (paste a public URL or
  // connect the GitHub App), which writes `repo` via setFieldValue; an empty
  // value means nothing's bound yet.
  repo: z.string().min(1, "Connect a repository to continue."),
  branch: z.string(),
  root: z.string(),
  autoDeploy: z.boolean(),
  previewBranches: z.boolean(),
});
