import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { HeaderActions, type HeaderResource } from "./panel-header-actions";

const IT_TOOLS: HeaderResource = {
  name: "it-tools",
  image: "ghcr.io/corentinth/it-tools:latest",
  source: "image",
};

function render(resource: HeaderResource, paused = false) {
  return renderToStaticMarkup(
    <HeaderActions
      resource={resource}
      onRestart={() => {}}
      restarting={false}
      onBuild={() => {}}
      building={false}
      onRedeploy={() => {}}
      redeploying={false}
      pause={{ paused, onPause: () => {}, onResume: () => {}, busy: false }}
    />,
  );
}

describe("service header actions", () => {
  it("offers an image service Redeploy, so a moved tag can be pulled again", () => {
    const out = render(IT_TOOLS);
    expect(out).toContain(">Redeploy<");
    expect(out).toContain("Restart");
  });

  it("offers nothing to redeploy while paused: resume first", () => {
    expect(render(IT_TOOLS, true)).not.toContain("Redeploy");
  });
});
