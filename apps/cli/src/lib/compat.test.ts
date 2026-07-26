import {
  MIN_CLI_VERSION_HEADER,
  SERVER_VERSION_HEADER,
} from "@otterdeploy/api/routers/system/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CLI_VERSION } from "../version";
import { observeCompatHeaders, reportCompatWarning, resetCompatState } from "./compat";

/** Warnings and hints go to stderr — capture that, not stdout. */
function captureStderr() {
  const written: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array): boolean => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    });
  return { written, restore: () => spy.mockRestore(), text: () => written.join("") };
}

function headers(record: Record<string, string>): Headers {
  return new Headers(record);
}

/** A release two minors behind whatever this CLI is, so the gap is real. */
function olderThanCli(): string {
  const [major = "0", minor = "0"] = CLI_VERSION.split(".");
  const behind = Number(minor) >= 2 ? Number(minor) - 2 : 0;
  return Number(minor) >= 2 ? `${major}.${behind}.0` : `${Number(major) - 1}.0.0`;
}

describe("CLI version handshake", () => {
  beforeEach(() => {
    resetCompatState();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says nothing when the server never sent the headers", () => {
    const stderr = captureStderr();
    observeCompatHeaders(headers({}));
    reportCompatWarning();
    stderr.restore();
    expect(stderr.text()).toBe("");
  });

  it("says nothing when the control plane is a dev build", () => {
    const stderr = captureStderr();
    observeCompatHeaders(
      headers({ [SERVER_VERSION_HEADER]: "dev", [MIN_CLI_VERSION_HEADER]: "0.1.0" }),
    );
    reportCompatWarning();
    stderr.restore();
    expect(stderr.text()).toBe("");
  });

  it("warns when this CLI is below the server's floor", () => {
    const stderr = captureStderr();
    observeCompatHeaders(
      headers({ [SERVER_VERSION_HEADER]: "99.0.0", [MIN_CLI_VERSION_HEADER]: "98.0.0" }),
    );
    reportCompatWarning();
    stderr.restore();
    expect(stderr.text()).toMatch(/98\.0\.0 or newer/);
    expect(stderr.text()).toMatch(/npm install -g @otterdeploy\/cli/);
  });

  it("warns when the control plane trails this CLI's generation", () => {
    const behind = olderThanCli();
    const stderr = captureStderr();
    observeCompatHeaders(
      headers({ [SERVER_VERSION_HEADER]: behind, [MIN_CLI_VERSION_HEADER]: "0.1.0" }),
    );
    reportCompatWarning();
    stderr.restore();
    expect(stderr.text()).toContain(behind);
    expect(stderr.text()).toMatch(/platform update/);
  });

  // The boundary calls this on both the success and failure paths; a command
  // that fails must not print the same notice twice.
  it("speaks at most once per invocation", () => {
    const stderr = captureStderr();
    observeCompatHeaders(
      headers({ [SERVER_VERSION_HEADER]: "99.0.0", [MIN_CLI_VERSION_HEADER]: "98.0.0" }),
    );
    reportCompatWarning();
    const afterFirst = stderr.text();
    reportCompatWarning();
    stderr.restore();
    expect(stderr.text()).toBe(afterFirst);
  });

  it("honours OTTERDEPLOY_NO_VERSION_WARNING", () => {
    vi.stubEnv("OTTERDEPLOY_NO_VERSION_WARNING", "1");
    const stderr = captureStderr();
    observeCompatHeaders(
      headers({ [SERVER_VERSION_HEADER]: "99.0.0", [MIN_CLI_VERSION_HEADER]: "98.0.0" }),
    );
    reportCompatWarning();
    stderr.restore();
    expect(stderr.text()).toBe("");
  });

  // Mid-update the control plane's version genuinely changes underneath a
  // running command; the verdict should reflect where it ended up.
  it("keeps the most recent server version it saw", () => {
    const stderr = captureStderr();
    observeCompatHeaders(
      headers({ [SERVER_VERSION_HEADER]: "99.0.0", [MIN_CLI_VERSION_HEADER]: "98.0.0" }),
    );
    observeCompatHeaders(
      headers({ [SERVER_VERSION_HEADER]: "99.1.0", [MIN_CLI_VERSION_HEADER]: "0.1.0" }),
    );
    reportCompatWarning();
    stderr.restore();
    expect(stderr.text()).toBe("");
  });

  // An intermediate response without the headers must not erase what we knew.
  it("does not forget a version when a later response omits the headers", () => {
    const stderr = captureStderr();
    observeCompatHeaders(
      headers({ [SERVER_VERSION_HEADER]: "99.0.0", [MIN_CLI_VERSION_HEADER]: "98.0.0" }),
    );
    observeCompatHeaders(headers({}));
    reportCompatWarning();
    stderr.restore();
    expect(stderr.text()).toMatch(/98\.0\.0 or newer/);
  });
});
