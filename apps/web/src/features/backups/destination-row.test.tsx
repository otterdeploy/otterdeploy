/**
 * A destination the server has not confirmed yet cannot be acted on: its id may
 * still be the optimistic one, so Test, Edit and Delete wait for the server's
 * row.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { ID_PREFIX, createId } from "@otterdeploy/shared/id";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Destination } from "./data/destinations";

vi.mock("@/shared/server/orpc", () => ({ orpc: {}, queryClient: {} }));
vi.mock("./data/destinations", () => ({
  destinationsCollection: {},
  setDestinationEnabled: vi.fn(),
  setDestinationUsedForBackups: vi.fn(),
  testDestination: vi.fn(),
}));

const { DestinationRow } = await import("./destination-row");

const dest: Destination = {
  id: createId(ID_PREFIX.backupDestination),
  organizationId: "org_1",
  name: "offsite-s3",
  type: "s3",
  config: { bucket: "b", endpoint: "https://s3.example" },
  status: "active",
  managed: false,
  usedForBackups: true,
  usedBytes: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** Whether the Test button carries the `disabled` attribute (its class list
 *  mentions `disabled:` variants either way). */
function testDisabled(html: string): boolean {
  const button = /<button[^>]*title="Validate stored credential"[^>]*>/.exec(html)?.[0] ?? "";
  return /\sdisabled(=""|\s|>)/.test(button);
}

describe("DestinationRow", () => {
  it("holds every action while the row is unconfirmed", () => {
    const html = renderToStaticMarkup(
      <DestinationRow dest={{ ...dest }} first pending onEdit={() => {}} />,
    );
    expect(testDisabled(html)).toBe(true);
    expect(html).toContain("Saving…");
  });

  it("offers Test once the server has the row", () => {
    const html = renderToStaticMarkup(
      <DestinationRow dest={{ ...dest }} first onEdit={() => {}} />,
    );
    expect(testDisabled(html)).toBe(false);
    expect(html).not.toContain("Saving…");
  });
});
