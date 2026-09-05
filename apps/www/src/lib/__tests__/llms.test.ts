import { describe, expect, test } from "bun:test";

import { llmsIndexText, type LlmsPage } from "../llms";

const pages: LlmsPage[] = [
  {
    url: "/docs",
    data: {
      title: "Introduction",
      seoTitle: "Self-hosted deployment platform documentation",
      description: "Understand the platform.",
    },
  },
  {
    url: "/docs/start/install",
    data: {
      title: "Install",
      seoTitle: "Install on a Linux server",
      description: "Install the control plane.",
    },
  },
  {
    url: "/docs/openapi/projects/list",
    data: {
      title: "List projects",
      description: "Generated API operation.",
      _openapi: {},
    },
  },
];

describe("llmsIndexText", () => {
  const text = llmsIndexText(pages);

  test("puts the site and documentation overview before task-specific sections", () => {
    expect(text.indexOf("## Overview")).toBeGreaterThan(-1);
    expect(text.indexOf("## Overview")).toBeLessThan(text.indexOf("## Getting started"));
    expect(text).toContain("[otterdeploy home](https://otterdeploy.com/)");
    expect(text).toContain("[Platform comparison](https://otterdeploy.com/#compare)");
    expect(text).toContain("[Frequently asked questions](https://otterdeploy.com/#faq)");
  });

  test("uses descriptive search titles instead of terse navigation labels", () => {
    expect(text).toContain(
      "[Self-hosted deployment platform documentation](https://otterdeploy.com/docs)",
    );
    expect(text).toContain(
      "[Install on a Linux server](https://otterdeploy.com/docs/start/install)",
    );
    expect(text).not.toContain("[Install](https://otterdeploy.com/docs/start/install)");
  });

  test("keeps generated OpenAPI operation pages out of the discovery index", () => {
    expect(text).not.toContain("Generated API operation");
    expect(text).not.toContain("/docs/openapi/projects/list");
  });
});
