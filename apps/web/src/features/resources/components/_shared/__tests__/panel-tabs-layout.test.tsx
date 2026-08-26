import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { PanelTabsLayout } from "../panel-tabs-layout";
import { PanelWidthProvider } from "../panel-width";

const TABS = [
  { value: "services", label: "Services", count: 2 },
  { value: "file", label: "Compose" },
  { value: "settings", label: "Settings", disabled: true },
];

/** Renders the layout inside (or outside) a width provider. The provider
 *  starts collapsed and reads localStorage in an effect, which never runs
 *  server-side — so this covers the collapsed and the no-provider cases, and
 *  the rail is asserted through the expanded branch below. */
function render(node: React.ReactNode) {
  return renderToStaticMarkup(<>{node}</>);
}

describe("PanelTabsLayout", () => {
  const layout = (
    <PanelTabsLayout tabs={TABS} value="services" onValueChange={() => {}}>
      <div>pane</div>
    </PanelTabsLayout>
  );

  it("renders the horizontal strip when the panel is not resizable", () => {
    // No provider: a panel outside the graph drawer must still work, and it
    // must read as narrow rather than growing a rail it can't collapse.
    const out = render(layout);
    expect(out).toContain("Services");
    expect(out).not.toContain("w-[188px]");
  });

  it("keeps the count out of the strip, where there is no room for it", () => {
    const out = render(layout);
    // The count is a rail affordance. In the strip, seven service tabs are
    // already ~460px of labels.
    expect(out).not.toContain(">2<");
  });

  it("marks a disabled tab disabled in both widths", () => {
    expect(render(layout)).toContain("disabled");
  });

  it("renders its children in a scrolling pane", () => {
    const out = render(layout);
    expect(out).toContain("pane");
    expect(out).toContain("overflow-y-auto");
  });

  it("gives the pane min-w-0 so a wide log can't push the rail off", () => {
    // Without it, an unbreakable line in the pane wins the flex negotiation
    // and the 188px rail gets squeezed to nothing.
    expect(render(layout)).toContain("min-w-0");
  });
});

describe("PanelWidthProvider", () => {
  it("starts collapsed, so the first paint matches the server's", () => {
    // The stored preference is read in an effect. Rendering the stored value
    // during render would make the first client paint disagree with the
    // server's and throw a hydration error in a private window.
    const out = renderToStaticMarkup(
      <PanelWidthProvider
        render={(expanded, children) => <div data-x={String(expanded)}>{children}</div>}
      >
        <span>body</span>
      </PanelWidthProvider>,
    );
    expect(out).toContain('data-x="false"');
    expect(out).toContain("body");
  });
});
