import { describe, expect, it } from "vitest";

import { renderWithRouter } from "@/test/utils";

import { InnerRail } from "./inner-rail";

describe("InnerRail", () => {
  it("renders 6 items", async () => {
    const { container } = await renderWithRouter(
      <InnerRail projectId="abc" currentHref="/project/abc" />,
    );
    expect(container.querySelectorAll("a[data-rail-item]").length).toBe(6);
  });

  it("Canvas link points to /project/$id (no trailing segment)", async () => {
    const { container } = await renderWithRouter(
      <InnerRail projectId="abc" currentHref="/project/abc" />,
    );
    const canvas = container.querySelector('a[data-rail-item][data-id="canvas"]');
    expect(canvas?.getAttribute("href")).toBe("/project/abc");
  });

  it("highlights Canvas when on the project root", async () => {
    const { container } = await renderWithRouter(
      <InnerRail projectId="abc" currentHref="/project/abc" />,
    );
    expect(
      container.querySelector('a[data-rail-item][data-id="canvas"]')?.getAttribute("data-active"),
    ).toBe("true");
  });

  it("highlights Logs when on /project/$id/logs", async () => {
    const { container } = await renderWithRouter(
      <InnerRail projectId="abc" currentHref="/project/abc/logs" />,
    );
    expect(
      container.querySelector('a[data-rail-item][data-id="logs"]')?.getAttribute("data-active"),
    ).toBe("true");
  });
});
