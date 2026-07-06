import { describe, expect, it } from "vitest";

import type { PreviewCommentRow } from "./preview-comment";

import {
  formatUpdatedUtc,
  renderPreviewComment,
  rowStatusFromDeployment,
} from "./preview-comment";

const at = new Date(Date.UTC(2026, 6, 6, 15, 38)); // Jul 6, 2026 3:38pm UTC

function row(overrides: Partial<PreviewCommentRow> = {}): PreviewCommentRow {
  return {
    projectName: "somnara",
    serviceName: "web",
    status: "building",
    inspectUrl: "https://panel.example.com/acme/somnara/graph/res_1/deployment/dep_1",
    previewUrl: "https://web-pr-13-somnara.apps.example.com",
    updatedAt: at,
    ...overrides,
  };
}

describe("renderPreviewComment", () => {
  it("renders the Vercel-style status table for a building preview", () => {
    const body = renderPreviewComment({
      prNumber: 13,
      headSha: "abcdef1234567890",
      rows: [row()],
      tornDown: false,
    });

    expect(body).toContain("**The latest updates on your preview environment.**");
    expect(body).toContain("| Service | Status | Preview | Updated (UTC) |");
    expect(body).toContain(
      "| **web** | 🟠 Building ([Inspect](https://panel.example.com/acme/somnara/graph/res_1/deployment/dep_1)) | [Visit Preview](https://web-pr-13-somnara.apps.example.com) | Jul 6, 2026 3:38pm |",
    );
    expect(body).toContain("`abcdef1`");
  });

  it("marks a ready row green and links the preview host", () => {
    const body = renderPreviewComment({
      prNumber: 13,
      headSha: "abcdef1234567890",
      rows: [row({ status: "ready" })],
      tornDown: false,
    });
    expect(body).toContain("🟢 Ready");
    expect(body).toContain("[Visit Preview](https://web-pr-13-somnara.apps.example.com)");
  });

  it("hides the preview link for failed/queued rows and dashes missing data", () => {
    const body = renderPreviewComment({
      prNumber: 13,
      headSha: "abcdef1234567890",
      rows: [
        row({ status: "failed" }),
        row({ serviceName: "api", status: "queued", inspectUrl: null, updatedAt: null }),
      ],
      tornDown: false,
    });
    expect(body).toContain("🔴 Failed");
    expect(body).not.toContain("Failed ([Inspect].*Visit Preview");
    expect(body).toContain("| **api** | ⚪ Queued | — | — |");
  });

  it("prefixes the project name only when the PR spans several projects", () => {
    const single = renderPreviewComment({
      prNumber: 1,
      headSha: "a1",
      rows: [row()],
      tornDown: false,
    });
    expect(single).toContain("| **web** |");

    const multi = renderPreviewComment({
      prNumber: 1,
      headSha: "a1",
      rows: [row(), row({ projectName: "otherproj", serviceName: "api" })],
      tornDown: false,
    });
    expect(multi).toContain("| Project | Status |");
    expect(multi).toContain("| **somnara / web** |");
    expect(multi).toContain("| **otherproj / api** |");
  });

  it("renders the torn-down body on close", () => {
    const body = renderPreviewComment({
      prNumber: 13,
      headSha: "abcdef1234567890",
      rows: [row({ status: "removed" })],
      tornDown: true,
    });
    expect(body).toContain("**Preview environment** for PR #13 has been torn down.");
    expect(body).not.toContain("| Service |");
  });
});

describe("formatUpdatedUtc", () => {
  it("formats like Vercel's comment timestamps, always UTC", () => {
    expect(formatUpdatedUtc(at)).toBe("Jul 6, 2026 3:38pm");
    expect(formatUpdatedUtc(new Date(Date.UTC(2026, 0, 2, 0, 5)))).toBe("Jan 2, 2026 12:05am");
    expect(formatUpdatedUtc(new Date(Date.UTC(2026, 11, 31, 12, 0)))).toBe("Dec 31, 2026 12:00pm");
  });
});

describe("rowStatusFromDeployment", () => {
  it("maps the deployment state machine onto comment statuses", () => {
    expect(rowStatusFromDeployment("running")).toBe("ready");
    expect(rowStatusFromDeployment("building")).toBe("building");
    expect(rowStatusFromDeployment("failed")).toBe("failed");
    expect(rowStatusFromDeployment("pending")).toBe("queued");
    expect(rowStatusFromDeployment(undefined)).toBe("queued");
  });
});
