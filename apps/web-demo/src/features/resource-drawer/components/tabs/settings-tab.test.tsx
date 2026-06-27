import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SettingsTab } from "./settings-tab";

vi.mock("@/utils/orpc", () => ({
  client: {
    project: {
      database: {
        postgres: {
          delete: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    },
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("SettingsTab", () => {
  it("requires confirmation before deleting", async () => {
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    render(
      <SettingsTab projectId="proj_1" resourceId="res_1" name="primary" onDeleted={onDeleted} />,
      { wrapper },
    );
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it("calls postgres.delete and onDeleted on confirm", async () => {
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    const { client } = await import("@/utils/orpc");
    render(
      <SettingsTab projectId="proj_1" resourceId="res_1" name="primary" onDeleted={onDeleted} />,
      { wrapper },
    );
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    const confirm = await screen.findByRole("button", {
      name: /delete database/i,
    });
    await user.click(confirm);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(client.project.database.postgres.delete).toHaveBeenCalledWith({
      projectId: "proj_1",
      resourceId: "res_1",
    });
  });
});
