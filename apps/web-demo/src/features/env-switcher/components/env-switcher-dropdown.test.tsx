import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { EnvSwitcherDropdown } from "./env-switcher-dropdown";

describe("EnvSwitcherDropdown", () => {
  it("renders the current env label", () => {
    render(<EnvSwitcherDropdown current="production" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /prod/i })).toBeInTheDocument();
  });

  it("calls onChange with the new env when an option is selected", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<EnvSwitcherDropdown current="production" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /prod/i }));
    await user.click(await screen.findByRole("menuitem", { name: /dev/i }));
    expect(onChange).toHaveBeenCalledWith("development");
  });
});
