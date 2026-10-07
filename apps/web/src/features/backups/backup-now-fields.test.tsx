/**
 * The "Run a backup now" fields say what they are.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { SourceKindField } from "./backup-now-parts";
import { databasePlaceholder } from "./database-combobox";

describe("source toggle", () => {
  const html = renderToStaticMarkup(<SourceKindField value="database" onChange={() => {}} />);

  it("is a named radio group, not buttons named by a wrapping label", () => {
    // Wrapped in <label>, the Database segment's accessible name was
    // "Source Volume" (axe button-name).
    expect(html).not.toContain("<label");
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Source"');
  });

  it("marks the chosen source and keeps one tab stop", () => {
    expect(html).toMatch(/role="radio" aria-checked="true" tabindex="0"[^>]*>Database</);
    expect(html).toMatch(/role="radio" aria-checked="false" tabindex="-1"[^>]*>Volume</);
  });
});

describe("database picker placeholder", () => {
  it("says it is loading until the source list answers", () => {
    // Loading rendered as empty: "No databases found" while the query ran.
    expect(databasePlaceholder(true, false)).toBe("Loading databases…");
    expect(databasePlaceholder(false, true)).toBe("No databases found");
    expect(databasePlaceholder(false, false)).toBe("Select a database");
  });
});
