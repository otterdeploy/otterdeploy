import { describe, expect, it } from "vitest";

import { renderWithRouter } from "@/test/utils";

import { OuterRail } from "./outer-rail";

describe("OuterRail", () => {
  it("renders one icon per outer rail item", async () => {
    const { container } = await renderWithRouter(<OuterRail currentHref="/" />);
    const links = container.querySelectorAll("a[data-rail-item]");
    expect(links.length).toBe(10);
  });

  it("marks the link matching currentHref as active", async () => {
    const { container } = await renderWithRouter(<OuterRail currentHref="/servers" />);
    const active = container.querySelector('a[data-rail-item][data-active="true"]');
    expect(active?.getAttribute("href")).toBe("/servers");
  });

  it("treats nested project routes as Projects-active", async () => {
    const { container } = await renderWithRouter(<OuterRail currentHref="/project/abc123" />);
    const active = container.querySelector('a[data-rail-item][data-active="true"]');
    expect(active?.getAttribute("href")).toBe("/");
  });
});
