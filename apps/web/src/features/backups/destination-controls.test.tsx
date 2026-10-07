/**
 * Deleting a backup destination asks first (access loss gets a styled
 * confirm). The delete control is a dialog trigger, not an action.
 */
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "vite-plus/test";

import { DestinationControls } from "./destination-controls";

function render(managed: boolean) {
  return renderToStaticMarkup(
    <DestinationControls
      name="offsite-s3"
      managed={managed}
      busy={false}
      disabled={false}
      browseOnly={false}
      onTest={() => {}}
      onToggleEnabled={() => {}}
      onToggleUsedForBackups={() => {}}
      onEdit={() => {}}
      onRemove={() => {}}
    />,
  );
}

describe("DestinationControls", () => {
  it("opens a confirmation instead of deleting on click", () => {
    const button =
      /<button[^>]*aria-label="Delete offsite-s3"[^>]*>/.exec(render(false))?.[0] ?? "";
    expect(button).toContain('aria-haspopup="dialog"');
  });

  it("offers no delete for the managed destination", () => {
    expect(render(true)).not.toContain("Delete offsite-s3");
  });
});
