/**
 * The label a compose child's generated public host is built from.
 *
 * A stack and its main service almost always share a name (51 of the 54
 * catalog templates), names are unique per project, so the child row lands as
 * `<stack>-service`, and that suffix used to leak into the URL. These pin the
 * rule that fixes it and, more importantly, the boundary that keeps it safe.
 */

import { describe, expect, it } from "vite-plus/test";

/** Mirror of the rule in expose.ts `generatedHostLabel`, with the DB read
 *  hoisted out so the decision itself is testable. */
function hostLabel(input: {
  resourceName: string;
  stackName: string | null;
  internalHostname: string;
}): string {
  if (!input.stackName) return input.resourceName;
  return input.internalHostname === input.stackName ? input.stackName : input.resourceName;
}

describe("generated host label", () => {
  it("uses the stack's name for the namesake service, not the -service suffix", () => {
    expect(
      hostLabel({
        resourceName: "drizzle-gateway-service",
        stackName: "drizzle-gateway",
        internalHostname: "drizzle-gateway",
      }),
    ).toBe("drizzle-gateway");
  });

  it("leaves a non-namesake sibling on its own label", () => {
    // Two stacks each containing a `db` must not both resolve to `db-<project>`.
    // That is one domain and the unique index would reject the second.
    expect(hostLabel({ resourceName: "db", stackName: "ghost", internalHostname: "db" })).toBe(
      "db",
    );
    expect(
      hostLabel({ resourceName: "db-service", stackName: "wordpress", internalHostname: "db" }),
    ).toBe("db-service");
  });

  it("leaves standalone services untouched", () => {
    expect(hostLabel({ resourceName: "api", stackName: null, internalHostname: "api" })).toBe(
      "api",
    );
  });

  it("does not fire when the child was renamed away from its compose key", () => {
    // An operator-renamed child no longer matches its stack; its own name wins,
    // because that is the name they chose.
    expect(
      hostLabel({ resourceName: "gateway", stackName: "drizzle-gateway", internalHostname: "web" }),
    ).toBe("gateway");
  });
});
