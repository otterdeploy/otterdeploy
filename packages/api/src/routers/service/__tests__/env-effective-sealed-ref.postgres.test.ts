/**
 * `service.env.effective` never resolves a sealed value into the browser,
 * whatever the referencing key happens to be called.
 *
 * Sealing is a property of the TARGET row, not of its name, so a reference
 * such as `${{billing.STRIPE_API_KEY}}` (a sealed row whose key matches no
 * secret-looking word) must be masked even though the reference text alone
 * would not trigger the key-name pattern. Sealed means write-only: no read
 * surface may ever return it.
 *
 * Real Postgres, real write path (`upsertServiceEnvVar` seals and encrypts),
 * real resolver. The non-secret control must keep passing: the surface exists
 * to show resolved hostnames.
 */
import { describe, expect, it } from "vite-plus/test";

import { seedOrganization, seedProject, seedService, uniq } from "../../../__tests__/postgres-seed";
import { listEffectiveEnv } from "../env-effective";
import { upsertServiceEnvVar } from "../queries";

async function seed() {
  const organizationId = await seedOrganization("effective");
  const { projectId, mainEnvironmentId } = await seedProject(organizationId);
  const billing = await seedService({
    projectId,
    environmentId: mainEnvironmentId,
    name: "billing",
  });
  const api = await seedService({ projectId, environmentId: mainEnvironmentId, name: "api" });

  const stripeKey = `sk_live_${uniq()}${uniq()}`;
  await upsertServiceEnvVar({
    serviceResourceId: billing.resourceId,
    key: "STRIPE_API_KEY",
    value: stripeKey,
    sealed: true,
  });
  await upsertServiceEnvVar({
    serviceResourceId: api.resourceId,
    key: "PAYMENTS_KEY",
    value: "${{billing.STRIPE_API_KEY}}",
  });
  await upsertServiceEnvVar({
    serviceResourceId: api.resourceId,
    key: "BILLING_HOST",
    value: "${{billing.HOST}}",
  });

  const rows = await listEffectiveEnv({ projectId, resourceId: api.resourceId, organizationId });
  if (rows.isErr()) throw new Error(`listEffectiveEnv: ${rows.error.message}`);
  const byKey = new Map(rows.value.map((r) => [r.key, r]));
  return { byKey, stripeKey, billingHost: billing.host };
}

describe("effective env masks a reference to a sealed variable", () => {
  it("a reference to a sealed variable is masked even when its key matches no secret pattern", async () => {
    const { byKey, stripeKey } = await seed();
    const row = byKey.get("PAYMENTS_KEY");
    expect(row?.unresolved).toBe(false);
    expect(JSON.stringify(row)).not.toContain(stripeKey);
  });

  // Control: the resolver ran (so the case above fails on masking, not on
  // setup), and a non-secret reference stays readable.
  it("a reference to a non-secret value still shows what it resolves to", async () => {
    const { byKey, billingHost } = await seed();
    expect(byKey.get("BILLING_HOST")?.value).toBe(billingHost);
  });
});
