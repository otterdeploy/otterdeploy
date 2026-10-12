/** The inbound endpoint URL carries its token in the path: masked by default. */
import { renderToStaticMarkup } from "react-dom/server";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { describe, expect, it, vi } from "vite-plus/test";

import type { InboundEndpoint } from "./shared";

vi.mock("@/shared/server/orpc", () => ({ client: {} }));
vi.mock("./data/webhooks", () => ({ inboundCollection: {}, invalidateInbound: vi.fn() }));
vi.mock("@otterdeploy/env/web", () => ({ env: { VITE_SERVER_URL: "https://od.example.com" } }));

const { InboundCard } = await import("./inbound-card");

const id = createId(ID_PREFIX.inboundEndpoint);

const endpoint: InboundEndpoint = {
  id,
  name: "deploy-web",
  token: "in_9f2c41d7a0b3e6",
  action: "none",
  resourceId: null,
  resourceName: null,
  projectSlug: null,
  ipAllowlist: [],
  lastInvokedAt: null,
  status: "active",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  $synced: true,
  $origin: "remote",
  $key: id,
  $collectionId: "inbound",
};

describe("InboundCard", () => {
  it("masks the token in the endpoint URL, keeping the rest readable", () => {
    const html = renderToStaticMarkup(<InboundCard endpoint={endpoint} onEdit={() => {}} />);
    expect(html).not.toContain("in_9f2c41d7a0b3e6");
    expect(html).toContain("https://od.example.com/api/webhooks/in/");
    expect(html).toContain('aria-label="Reveal endpoint URL"');
    expect(html).toContain('aria-label="Copy endpoint URL"');
  });
});
