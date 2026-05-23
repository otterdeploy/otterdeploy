import { ChevronsUpDownIcon } from "lucide-react";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { cn } from "@/lib/utils";
import { envOptions, type EnvName } from "../types";

const dotByColor: Record<"emerald" | "amber" | "rose", string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};

type Props = {
  current: EnvName;
  onChange: (next: EnvName) => void;
};

export function EnvSwitcherDropdown({ current, onChange }: Props) {
  const active = envOptions.find((e) => e.name === current) ?? envOptions[0];
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-background px-2 text-xs hover:bg-accent"
          />
        }
      >
        <span
          className={cn("size-1.5 rounded-full", dotByColor[active.color])}
        />
        <span className="font-medium">{active.label}</span>
        <ChevronsUpDownIcon className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup className="min-w-32">
        {envOptions.map((option) => (
          <MenuItem
            key={option.name}
            onClick={() => onChange(option.name)}
            data-active={option.name === current}
          >
            <span
              className={cn("size-1.5 rounded-full", dotByColor[option.color])}
            />
            {option.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
