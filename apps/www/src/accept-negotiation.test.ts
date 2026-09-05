import { describe, expect, test } from "bun:test";

import {
  frameworkCompatibleHtmlRequest,
  handleHtmlNegotiation,
  normalizeTanStackHtmlNegotiation,
} from "./accept-negotiation";

const tanStackNegotiationFailure = (headers?: HeadersInit) =>
  Response.json(
    {
      error: "Only HTML requests are supported here",
    },
    { status: 500, headers },
  );

/** The exact Accept predicate in locked @tanstack/start-server-core 1.169.14. */
const pinnedStartHandler = (request: Request) => {
  const accept = request.headers.get("accept") ?? "*/*";
  const supported = ["*/*", "text/html"].some((mimeType) =>
    accept.split(",").some((part) => part.trim().startsWith(mimeType)),
  );

  return supported
    ? new Response("<!doctype html><title>Document</title>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    : tanStackNegotiationFailure();
};

describe("frameworkCompatibleHtmlRequest", () => {
  test.each(["TEXT/HTML", "text/*;q=0.2", "application/json, TEXT/*;Q=0.4"])(
    "makes the pinned Start predicate accept semantically valid %s",
    (accept) => {
      const original = new Request("https://otterdeploy.com/docs", { headers: { accept } });
      const request = frameworkCompatibleHtmlRequest(original);

      expect(request).not.toBe(original);
      expect(request.headers.get("accept")).toStartWith(accept);
      expect(pinnedStartHandler(request).status).toBe(200);
      expect(original.headers.get("accept")).toBe(accept);
    },
  );

  test.each(["text/html", "*/*", "text/html;q=0", "application/json"])(
    "does not rewrite %s",
    (accept) => {
      const original = new Request("https://otterdeploy.com/docs", { headers: { accept } });
      expect(frameworkCompatibleHtmlRequest(original)).toBe(original);
    },
  );

  test("preserves the method and body when a request needs normalising", async () => {
    const original = new Request("https://otterdeploy.com/docs", {
      method: "POST",
      headers: { accept: "TEXT/HTML" },
      body: "payload",
    });

    const request = frameworkCompatibleHtmlRequest(original);
    expect(request.method).toBe("POST");
    expect(await request.text()).toBe("payload");
  });
});

describe("handleHtmlNegotiation", () => {
  test.each(["TEXT/HTML", "text/*;q=0.2"])(
    "serves HTML through the pinned Start predicate for %s",
    async (accept) => {
      const response = await handleHtmlNegotiation(
        new Request("https://otterdeploy.com/docs", { headers: { accept } }),
        pinnedStartHandler,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("vary")).toBe("Accept");
      expect(await response.text()).toContain("<!doctype html>");
    },
  );

  test.each(["application/json", "text/html;q=0", "*/*;q=0"])(
    "returns 406 through the pinned Start predicate for %s",
    async (accept) => {
      const response = await handleHtmlNegotiation(
        new Request("https://otterdeploy.com/docs", { headers: { accept } }),
        pinnedStartHandler,
      );

      expect(response.status).toBe(406);
      expect(response.headers.get("vary")).toBe("Accept");
    },
  );

  test("leaves an exact non-HTML server route response untouched", async () => {
    const original = new Response("<urlset />", {
      headers: { "content-type": "application/xml" },
    });
    const response = await handleHtmlNegotiation(
      new Request("https://otterdeploy.com/sitemap.xml", {
        headers: { accept: "application/xml" },
      }),
      () => original,
    );

    expect(response).toBe(original);
    expect(response.headers.get("vary")).toBeNull();
  });
});

describe("normalizeTanStackHtmlNegotiation", () => {
  test("turns TanStack's unsupported Markdown 500 into a non-cacheable 406", async () => {
    const request = new Request("https://otterdeploy.com/docs", {
      headers: { accept: "text/markdown" },
    });

    const response = await normalizeTanStackHtmlNegotiation(request, tanStackNegotiationFailure());

    expect(response.status).toBe(406);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Accept");
    expect(await response.text()).toContain("available as text/html");
  });

  test("preserves existing Vary dimensions when adding Accept", async () => {
    const request = new Request("https://otterdeploy.com/docs", {
      headers: { accept: "application/json" },
    });

    const response = await normalizeTanStackHtmlNegotiation(
      request,
      tanStackNegotiationFailure({ vary: "Origin" }),
    );

    expect(response.status).toBe(406);
    expect(response.headers.get("vary")).toBe("Origin, Accept");
  });

  test("adds Vary to successful HTML responses", async () => {
    const request = new Request("https://otterdeploy.com/docs", {
      headers: { accept: "text/html" },
    });
    const original = new Response("document", {
      headers: { "content-type": "text/html", vary: "Accept-Encoding" },
    });

    const response = await normalizeTanStackHtmlNegotiation(request, original);

    expect(response).toBe(original);
    expect(response.headers.get("vary")).toBe("Accept-Encoding, Accept");
  });

  test("rejects an actual HTML response when the effective HTML quality is zero", async () => {
    const request = new Request("https://otterdeploy.com/docs", {
      headers: { accept: "text/html;q=0, */*;q=1" },
    });
    const response = await normalizeTanStackHtmlNegotiation(
      request,
      new Response("document", { headers: { "content-type": "text/html" } }),
    );

    expect(response.status).toBe(406);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Accept");
  });

  test("does not touch responses for requests that accept HTML", async () => {
    for (const accept of ["text/markdown, text/html;q=0.5", "TEXT/HTML", "text/*;q=0.2", "*/*"]) {
      const request = new Request("https://otterdeploy.com/docs", {
        headers: { accept },
      });
      const original = tanStackNegotiationFailure();

      expect(await normalizeTanStackHtmlNegotiation(request, original)).toBe(original);
    }
  });

  test("honors an explicit q=0 refusal using the most specific matching range", async () => {
    for (const accept of [
      "text/html;q=0",
      "text/*;q=0",
      "*/*;q=0",
      "TEXT/HTML; Q=0",
      "text/html;q=0, */*;q=1",
      "*/*;q=1, text/*;q=0",
    ]) {
      const request = new Request("https://otterdeploy.com/docs", {
        headers: { accept },
      });

      expect(
        (await normalizeTanStackHtmlNegotiation(request, tanStackNegotiationFailure())).status,
      ).toBe(406);
    }
  });

  test("does not disguise an unrelated application error", async () => {
    const request = new Request("https://otterdeploy.com/docs", {
      headers: { accept: "text/markdown" },
    });
    const original = Response.json({ error: "Database unavailable" }, { status: 500 });

    expect(await normalizeTanStackHtmlNegotiation(request, original)).toBe(original);
    expect(await original.json()).toEqual({ error: "Database unavailable" });
  });

  test("requires the exact framework sentinel shape", async () => {
    const request = new Request("https://otterdeploy.com/docs", {
      headers: { accept: "text/markdown" },
    });
    const original = Response.json(
      {
        error: "Only HTML requests are supported here",
        route: "/docs",
      },
      { status: 500 },
    );

    expect(await normalizeTanStackHtmlNegotiation(request, original)).toBe(original);
  });

  test("keeps HEAD negotiation responses bodyless", async () => {
    const request = new Request("https://otterdeploy.com/docs", {
      method: "HEAD",
      headers: { accept: "text/markdown" },
    });

    const response = await normalizeTanStackHtmlNegotiation(request, tanStackNegotiationFailure());

    expect(response.status).toBe(406);
    expect(await response.text()).toBe("");
  });
});
