import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActiveSection } from "./use-active-section";
import type { SettingsSection } from "../types";

const sections: ReadonlyArray<SettingsSection> = [
  { id: "general", label: "General" },
  { id: "danger", label: "Danger" },
];

describe("useActiveSection", () => {
  it("starts with the first section active when nothing has been observed yet", () => {
    const { result } = renderHook(() => useActiveSection(sections));
    expect(result.current.activeId).toBe("general");
  });

  it("setActive updates the active id", () => {
    const { result } = renderHook(() => useActiveSection(sections));
    act(() => result.current.setActive("danger"));
    expect(result.current.activeId).toBe("danger");
  });

  it("ignores ids not in the section list", () => {
    const { result } = renderHook(() => useActiveSection(sections));
    act(() => result.current.setActive("not-a-section"));
    expect(result.current.activeId).toBe("general");
  });
});
