/**
 * The lab's single environment boundary. Every value arrives through varlock
 * (`bun varlock run -p ./test-infra/lab -- …`), which resolves the secrets
 * from Infisical; see ./.env.schema. Parsed once, here, so the rest of the lab
 * never reads `process.env` and never sees an unvalidated value.
 */
import * as z from "zod";

const labEnvSchema = z.object({
  HCLOUD_TOKEN: z.string().min(1),
  CF_DNS_TOKEN: z.string().min(1),
  CF_ZONE_ID: z.string().min(1),
  LAB_DNS_SUFFIX: z
    .string()
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "LAB_DNS_SUFFIX must be a bare DNS name"),
  LAB_BUDGET_EUR: z.coerce.number().positive(),
  LAB_MAX_RUN_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 60),
});

export type LabEnv = z.infer<typeof labEnvSchema>;

export function loadLabEnv(): LabEnv {
  /* oxlint-disable-next-line node/no-process-env -- the lab's one env boundary; varlock injects these, outside the server env schema */
  const parsed = labEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    console.error(
      `Lab environment is incomplete (${missing}). Run through varlock:\n` +
        "  bun varlock run -p ./test-infra/lab -- bun test-infra/lab/lab.ts <command>",
    );
    process.exit(2);
  }
  return parsed.data;
}
