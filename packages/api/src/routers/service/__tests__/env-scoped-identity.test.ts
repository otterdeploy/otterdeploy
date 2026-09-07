/**
 * od-4osd: the same service name in two environments is a legal, distinct pair.
 *
 * `service_resource` used to carry a global unique on `serviceName` and one on
 * (networkName, internalHostname). Both rejected a staging `api` purely for
 * existing beside production's, which is why every resource here had to be
 * named `api-prod` / `api-staging` by hand.
 *
 * The reason those indexes were wrong, and the reason dropping them is safe,
 * is the same fact: the STORED name is the base, and the environment suffix is
 * applied at READ time by `runtimeServiceName`. So two rows deliberately share
 * a base string and still deploy as two different containers. That is the
 * invariant these pin — the constraint that matters is on the derived runtime
 * name, and it holds without any database index.
 *
 * Note this is exactly why the database fix (od-jwx/#274) could NOT be copied:
 * there the stored hostname IS the runtime hostname, so scoping the stored name
 * was right. Doing that here would deploy `api-staging-staging`.
 */
import { describe, expect, it } from "vite-plus/test";

import { BASE, environmentScope, runtimeServiceName } from "../../../lib/environment/scoping";
import { deriveServiceNames } from "../inputs";

const production = environmentScope({ slug: "production", isMain: true });
const staging = environmentScope({ slug: "staging", isMain: false });

describe("service identity across environments", () => {
  it("derives one shared base identity, which is why a unique index on it was wrong", () => {
    const prod = deriveServiceNames("praxly", "api");
    const stage = deriveServiceNames("praxly", "api");

    // Byte-identical. Under the old indexes this pair could not both exist.
    expect(stage.serviceName).toBe(prod.serviceName);
    expect(stage.internalHostname).toBe(prod.internalHostname);
    expect(stage.networkName).toBe(prod.networkName);
  });

  it("deploys them under distinct runtime names, with no index doing the work", () => {
    const { serviceName, internalHostname } = deriveServiceNames("praxly", "api");

    expect(runtimeServiceName(serviceName, production)).toBe("od-praxly-api");
    expect(runtimeServiceName(serviceName, staging)).toBe("od-praxly-api-staging");
    expect(runtimeServiceName(internalHostname, staging)).toBe("api-staging");

    expect(runtimeServiceName(serviceName, staging)).not.toBe(
      runtimeServiceName(serviceName, production),
    );
  });

  it("keeps every already-deployed service byte-identical", () => {
    // The safety property. Main renders as base, and an unstamped row resolves
    // to BASE, so nothing currently running is renamed by any of this.
    const { serviceName, internalHostname } = deriveServiceNames("praxly", "api");

    expect(runtimeServiceName(serviceName, production)).toBe(serviceName);
    expect(runtimeServiceName(serviceName, BASE)).toBe(serviceName);
    expect(runtimeServiceName(serviceName, null)).toBe(serviceName);
    expect(runtimeServiceName(internalHostname, BASE)).toBe(internalHostname);
  });

  it("still separates two projects that both run a service called api", () => {
    // What the (networkName, internalHostname) unique was really protecting.
    // The project slug is in both derived names, so it survives the index drop.
    const praxly = deriveServiceNames("praxly", "api");
    const other = deriveServiceNames("acme", "api");

    expect(praxly.serviceName).not.toBe(other.serviceName);
    expect(praxly.networkName).not.toBe(other.networkName);
  });
});
