/**
 * Creating the first project: the empty state must not own the
 * create dialog. The optimistic row flips the page to the list on the next
 * render, so a dialog living here unmounted the moment Create was clicked.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { ProjectsEmpty } from "./projects-empty";

describe("ProjectsEmpty", () => {
  it("asks the route to open the dialog instead of hosting one", () => {
    const html = renderToStaticMarkup(
      <ProjectsEmpty organizationName="Acme" onNewProject={() => {}} />,
    );
    expect(html).toContain("New project");
    expect(html).toContain("No projects in Acme");
    // A dialog trigger announces the popup it owns. This button owns none.
    expect(html).not.toContain('aria-haspopup="dialog"');
  });
});
