import { workspaceSettingsSections } from "@/features/workspace-settings";

const groupedSections = {
  infrastructure: workspaceSettingsSections.filter((section) => section.group === "infrastructure"),
  workspace: workspaceSettingsSections.filter((section) => section.group !== "infrastructure"),
};

export function WorkspaceSettingsRail() {
  return (
    <nav
      aria-label="Workspace settings navigation"
      className="sticky top-0 h-full w-56 overflow-auto border-r border-border bg-sidebar/40 px-3 py-4"
    >
      <div className="grid gap-5">
        <RailGroup label="Infrastructure" items={groupedSections.infrastructure} />
        <RailGroup label="Workspace" items={groupedSections.workspace} />
      </div>
    </nav>
  );
}

function RailGroup({ label, items }: { label: string; items: typeof workspaceSettingsSections }) {
  return (
    <div className="grid gap-1">
      <div className="px-2 pb-1 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </div>
      {items.map((section) => (
        <a
          key={section.id}
          href={`/settings#${section.id}`}
          className="rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {section.label}
        </a>
      ))}
    </div>
  );
}
