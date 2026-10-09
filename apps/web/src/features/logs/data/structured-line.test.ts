/**
 * Project Logs showed Caddy-in-container access logs as raw JSON
 * in the MESSAGE column, `{"level":"info","ts":1791434574.56,"logger":…`, with
 * the level read out of the object but the message left buried in it.
 */
import { describe, expect, it } from "vite-plus/test";

import { parseStructuredLine } from "./structured-line";

/** A line from the tour, as the container wrote it. */
const CADDY_LINE = JSON.stringify({
  level: "info",
  ts: 1791434574.5641966,
  logger: "http.log.access.log0",
  msg: "handled request",
  request: {
    remote_ip: "10.0.1.4",
    method: "GET",
    uri: "/favicon.ico",
    headers: { Accept: ["*/*"] },
  },
  bytes_read: 0,
  duration: 0.000412,
  size: 781,
  status: 200,
});

describe("parseStructuredLine", () => {
  it("reads the message out of a JSON log line", () => {
    const line = parseStructuredLine(CADDY_LINE);
    expect(line?.message).toBe("handled request");
  });

  it("keeps every other field, nested ones intact, for the detail panel", () => {
    const line = parseStructuredLine(CADDY_LINE);
    expect(line?.fields).not.toHaveProperty("msg");
    expect(line?.fields.logger).toBe("http.log.access.log0");
    expect(line?.fields.request).toEqual({
      remote_ip: "10.0.1.4",
      method: "GET",
      uri: "/favicon.ico",
      headers: { Accept: ["*/*"] },
    });
  });

  it("previews the fields not already on screen, scalars before nested ones", () => {
    const preview = parseStructuredLine(CADDY_LINE)?.preview ?? "";
    expect(preview.startsWith("logger=http.log.access.log0")).toBe(true);
    expect(preview).toContain("status=200");
    expect(preview).toContain("request.method=GET");
    expect(preview).toContain("request.uri=/favicon.ico");
    // Level and timestamp have their own columns.
    expect(preview).not.toContain("level=");
    expect(preview).not.toContain("ts=");
    expect(preview.indexOf("status=200")).toBeLessThan(preview.indexOf("request.method"));
  });

  it("accepts `message` as well as `msg`", () => {
    expect(parseStructuredLine('{"level":30,"message":"listening on :3000"}')?.message).toBe(
      "listening on :3000",
    );
  });

  it("leaves plain text, broken JSON and message-less objects alone", () => {
    expect(parseStructuredLine("2026/10/08 04:32:36 Starting up on port 80")).toBeNull();
    expect(parseStructuredLine('{"level":"info","msg":')).toBeNull();
    expect(parseStructuredLine('{"level":"info","count":3}')).toBeNull();
    expect(parseStructuredLine('{"msg":""}')).toBeNull();
    expect(parseStructuredLine("[1,2,3]")).toBeNull();
  });
});
