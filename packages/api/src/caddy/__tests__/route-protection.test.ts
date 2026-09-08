import { createId, ID_PREFIX } from "@otterdeploy/shared/id";
import { describe, expect, it } from "vite-plus/test";

import { isRouteProtected } from "../route-protection";

const inPrivateEnv = createId(ID_PREFIX.proxyRoute);
const elsewhere = createId(ID_PREFIX.proxyRoute);
const privateEnvRoutes = new Set([inPrivateEnv]);
const noPrivateEnvs = new Set<typeof inPrivateEnv>();

describe("isRouteProtected", () => {
  it("protects a route because its environment is private", () => {
    expect(isRouteProtected({ id: inPrivateEnv, protected: false }, privateEnvRoutes)).toBe(true);
  });

  it("leaves a route in a public environment alone", () => {
    expect(isRouteProtected({ id: elsewhere, protected: false }, privateEnvRoutes)).toBe(false);
  });

  // The floor is additive. A public environment must not be able to strip a
  // route the operator locked on its own, which is what an AND would do the
  // moment someone turned the environment's switch back off.
  it("keeps a route's own lock when the environment is public", () => {
    expect(isRouteProtected({ id: elsewhere, protected: true }, noPrivateEnvs)).toBe(true);
  });

  it("is satisfied by either switch, not both", () => {
    expect(isRouteProtected({ id: inPrivateEnv, protected: true }, privateEnvRoutes)).toBe(true);
  });
});
