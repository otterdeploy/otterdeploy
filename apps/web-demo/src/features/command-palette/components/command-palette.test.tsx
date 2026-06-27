import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CommandPalette } from "./command-palette";

describe("CommandPalette", () => {
  it("is closed by default", () => {
    render(<CommandPalette />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on Cmd+K", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.keyboard("{Meta>}k{/Meta}");
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens when a synthetic Cmd+K keydown is dispatched on document", async () => {
    // BreadcrumbBar's search button uses this exact dispatch to open the palette.
    // If this contract changes, the breadcrumb button stops working silently.
    render(<CommandPalette />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
