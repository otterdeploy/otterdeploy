import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// The installation → provider host join, stubbed at the drizzle builder: the
// test controls which host row (if any) the query yields.
const { hostRows, selectSpy } = vi.hoisted(() => {
  const rows: { current: { host: string }[] } = { current: [] };
  return { hostRows: rows, selectSpy: vi.fn() };
});

interface SelectChain {
  from: () => SelectChain;
  innerJoin: () => SelectChain;
  where: () => SelectChain;
  limit: () => Promise<{ host: string }[]>;
}
const chain: SelectChain = {
  from: () => chain,
  innerJoin: () => chain,
  where: () => chain,
  limit: () => Promise.resolve(hostRows.current),
};

vi.mock("@otterdeploy/db", () => ({
  db: {
    select: () => {
      selectSpy();
      return chain;
    },
  },
}));

import { apiBaseUrlForHost, apiBaseUrlForInstallation } from "./github-app-config";

describe("apiBaseUrlForHost", () => {
  it("maps github.com to the public API host", () => {
    expect(apiBaseUrlForHost("github.com")).toBe("https://api.github.com");
  });

  it("maps a GitHub Enterprise host to its /api/v3 base", () => {
    expect(apiBaseUrlForHost("ghe.acme.corp")).toBe("https://ghe.acme.corp/api/v3");
  });
});

describe("apiBaseUrlForInstallation", () => {
  beforeEach(() => {
    hostRows.current = [];
    selectSpy.mockReset();
  });

  it("no installation (anonymous public read) ⇒ github.com, without a query", async () => {
    await expect(apiBaseUrlForInstallation(null)).resolves.toBe("https://api.github.com");
    expect(selectSpy).not.toHaveBeenCalled();
  });

  it("an installation on a GitHub Enterprise provider ⇒ that host's API", async () => {
    hostRows.current = [{ host: "ghe.acme.corp" }];
    await expect(apiBaseUrlForInstallation("12345")).resolves.toBe("https://ghe.acme.corp/api/v3");
  });

  it("an installation on github.com ⇒ the public API", async () => {
    hostRows.current = [{ host: "github.com" }];
    await expect(apiBaseUrlForInstallation("12345")).resolves.toBe("https://api.github.com");
  });

  it("an installation with no row falls back to github.com", async () => {
    await expect(apiBaseUrlForInstallation("404")).resolves.toBe("https://api.github.com");
  });
});
