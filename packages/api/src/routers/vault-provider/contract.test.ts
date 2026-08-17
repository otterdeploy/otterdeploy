/**
 * Contract-level guarantees: the provider name must survive the reference
 * grammar (`${{vault.<name>.<ref>}}`), and the kind union stays the
 * supported set (AWS/Azure/Scaleway are explicitly out of scope for now).
 */
import { describe, expect, it } from "vite-plus/test";

import { vaultProviderKindSchema, vaultProviderNameSchema } from "./contract";

describe("vaultProviderNameSchema", () => {
  it("accepts lowercase slugs", () => {
    for (const name of ["prod", "prod-vault", "team_a", "v2", "0x"]) {
      expect(vaultProviderNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("rejects names the reference parser could not round-trip", () => {
    for (const name of ["Prod", "-lead", "_lead", "has space", "has.dot", "", "a".repeat(65)]) {
      expect(vaultProviderNameSchema.safeParse(name).success).toBe(false);
    }
  });
});

describe("vaultProviderKindSchema", () => {
  it("covers exactly the supported providers", () => {
    expect(vaultProviderKindSchema.options).toEqual(["hashicorp", "infisical", "doppler"]);
    expect(vaultProviderKindSchema.safeParse("aws").success).toBe(false);
  });
});
