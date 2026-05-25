import { ChevronsUpDownIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import type { WorkspaceSummary } from "../types";

interface Props {
  current: WorkspaceSummary;
  workspaces: ReadonlyArray<WorkspaceSummary>;
  onSelect: (workspaceId: string) => void;
}

export function WorkspaceSwitcherDropdown({
  current,
  workspaces,
  onSelect,
}: Props) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-2 rounded-md px-2 text-sm hover:bg-accent"
          />
        }
      >
        <Avatar className="size-5 rounded">
          <AvatarFallback className="text-[10px]">
            {current.name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="font-medium">{current.name}</span>
        <ChevronsUpDownIcon className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup className="min-w-56">
        {workspaces.map((ws) => (
          <MenuItem key={ws.id} onClick={() => onSelect(ws.id)}>
            <Avatar className="size-5 rounded">
              <AvatarFallback className="text-[10px]">
                {ws.name.slice(0, 1).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span>{ws.name}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">
              {ws.role}
            </span>
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuItem onClick={() => onSelect("__create__")}>
          + New workspace
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
