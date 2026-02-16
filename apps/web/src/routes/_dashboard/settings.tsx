import { createFileRoute, Outlet } from "@tanstack/react-router";

import { SettingsNav } from "@/components/settings/settings-nav";

export const Route = createFileRoute("/_dashboard/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <div className="flex flex-1 overflow-hidden">
      <aside className="w-56 shrink-0 border-r p-4 overflow-auto">
        <h2 className="mb-4 text-lg font-semibold">Settings</h2>
        <SettingsNav />
      </aside>
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
