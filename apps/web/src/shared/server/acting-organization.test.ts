import { describe, expect, it } from "vite-plus/test";

import { actingOrganizationHeaders, actInOrganization } from "./acting-organization";

describe("the tab's acting organization", () => {
  it("is stated on every call once set, and not at all when cleared", () => {
    actInOrganization("org_a");
    expect(actingOrganizationHeaders()).toEqual({ "x-otterdeploy-organization": "org_a" });
    actInOrganization(null);
    expect(actingOrganizationHeaders()).toEqual({});
  });
});
