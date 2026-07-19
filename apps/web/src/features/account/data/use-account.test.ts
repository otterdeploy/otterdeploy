import { describe, expect, it } from "vite-plus/test";

import { describeAgent } from "./use-account";

describe("describeAgent", () => {
  it("labels a missing UA as unknown", () => {
    expect(describeAgent(null)).toBe("Unknown device");
    expect(describeAgent(undefined)).toBe("Unknown device");
    expect(describeAgent("")).toBe("Unknown device");
  });

  it("identifies desktop browsers with their OS", () => {
    expect(
      describeAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on macOS");
    expect(
      describeAgent("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0"),
    ).toBe("Firefox on Linux");
    expect(
      describeAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
      ),
    ).toBe("Edge on Windows");
  });

  it("prefers Safari only when no Chromium marker is present", () => {
    expect(
      describeAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iOS");
  });

  it("flags CLI-ish agents", () => {
    expect(describeAgent("otterdeploy-cli/1.2.0 (Linux)")).toBe("CLI on Linux");
    expect(describeAgent("curl/8.5.0")).toBe("CLI");
  });
});
