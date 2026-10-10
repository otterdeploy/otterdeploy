import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { ChangeDomainSummary } from "./change-domain-dialog";

describe("ChangeDomainSummary", () => {
  it("lists every hostname already exposed, each one staying as it is", () => {
    const html = renderToStaticMarkup(
      <ChangeDomainSummary
        current="acme.com"
        hostnames={["api-shop.acme.com", "web-shop.acme.com"]}
        total={2}
      />,
    );
    expect(html).toContain("api-shop.acme.com");
    expect(html).toContain("web-shop.acme.com");
    expect(html.match(/Keeps this hostname/g)).toHaveLength(2);
    expect(html).toContain("Keep the DNS for");
  });

  it("counts the hostnames it did not list", () => {
    const html = renderToStaticMarkup(
      <ChangeDomainSummary current="acme.com" hostnames={["web-shop.acme.com"]} total={51} />,
    );
    expect(html).toContain("and 50 more, which also keep their hostnames");
  });

  it("says nothing else changes when no service uses the domain yet", () => {
    const html = renderToStaticMarkup(
      <ChangeDomainSummary current="acme.com" hostnames={[]} total={0} />,
    );
    expect(html).toContain("No services are published under");
    expect(html).not.toContain("Keeps this hostname");
  });
});
