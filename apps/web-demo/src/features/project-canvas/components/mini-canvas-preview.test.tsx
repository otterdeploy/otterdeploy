import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MiniCanvasPreview } from "./mini-canvas-preview";

describe("MiniCanvasPreview", () => {
  it("renders empty state when nothing is configured", () => {
    const { container } = render(<MiniCanvasPreview databases={0} routes={0} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector('[data-mini="empty"]')).toBeInTheDocument();
  });

  it("renders one rect per database (capped at 4)", () => {
    const { container } = render(<MiniCanvasPreview databases={6} routes={1} />);
    expect(container.querySelectorAll('rect[data-mini="database"]').length).toBe(4);
    expect(container.querySelector('[data-mini="overflow"]')).toHaveTextContent("+2");
  });

  it("renders a routing circle when there's at least one route", () => {
    const { container } = render(<MiniCanvasPreview databases={1} routes={1} />);
    expect(container.querySelector('[data-mini="routing"]')).toBeInTheDocument();
  });
});
