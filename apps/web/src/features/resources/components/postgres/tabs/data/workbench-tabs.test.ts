import { describe, expect, it } from "vite-plus/test";

import type { WorkbenchTab } from "./workbench-tabs";

import { upsertWorkbenchTab } from "./workbench-tabs";

function tableTab(name: string, preview: boolean): WorkbenchTab {
  return {
    id: `table:public.${name}`,
    kind: "table",
    title: name,
    table: { schema: "public", name },
    preview,
  };
}

describe("upsertWorkbenchTab", () => {
  it("replaces the disposable preview when another table opens", () => {
    const next = tableTab("customers", true);
    expect(upsertWorkbenchTab([tableTab("orders", true)], next)).toEqual([next]);
  });

  it("keeps a pinned table and adds a new preview beside it", () => {
    const pinned = tableTab("orders", false);
    const preview = tableTab("customers", true);
    expect(upsertWorkbenchTab([pinned], preview)).toEqual([pinned, preview]);
  });

  it("does not turn an existing pinned tab back into a preview", () => {
    const pinned = tableTab("orders", false);
    const reopened = { ...pinned, preview: true };
    expect(upsertWorkbenchTab([pinned], reopened)).toEqual([pinned]);
  });
});
