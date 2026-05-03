import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useResourceDrawer } from "./use-resource-drawer";

describe("useResourceDrawer", () => {
  it("starts closed with no selection", () => {
    const { result } = renderHook(() => useResourceDrawer());
    expect(result.current.open).toBe(false);
    expect(result.current.selection).toBeNull();
  });

  it("selecting a resource opens the drawer", () => {
    const { result } = renderHook(() => useResourceDrawer());
    act(() => result.current.select({ kind: "database", resourceId: "res_1", projectId: "proj_1" }));
    expect(result.current.open).toBe(true);
    expect(result.current.selection).toEqual({ kind: "database", resourceId: "res_1", projectId: "proj_1" });
  });

  it("close() clears the selection", () => {
    const { result } = renderHook(() => useResourceDrawer());
    act(() => result.current.select({ kind: "database", resourceId: "res_1", projectId: "proj_1" }));
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
    expect(result.current.selection).toBeNull();
  });
});
