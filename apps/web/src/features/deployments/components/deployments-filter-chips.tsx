/**
 * The filter chips: Resource (one), Person (any number, plus "Automatic" for
 * deploys nobody triggered by hand) and the date range. A chip reads "+ Label"
 * while unset and names its value, with a clear button, once set.
 */

import {
  ArrowDown01Icon,
  Calendar03Icon,
  Cancel01Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { cn } from "@/shared/lib/utils";

import { DEPLOY_WINDOWS, type DeployWindow, windowLabel } from "../data/deployments-search";
import { ActorAvatar } from "./actor-avatar";

export interface ResourceOption {
  id: string;
  name: string;
}

export interface PersonOption {
  name: string;
  image: string | null;
  count: number;
}

/** A chip: dashed "+ Label" while unset, solid with its value and a clear
 *  button once set. */
function ChipTrigger({
  label,
  display,
  onClear,
  ...props
}: React.ComponentProps<"button"> & {
  label: string;
  /** The chip's current value, or null while unset. */
  display: React.ReactNode | null;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex items-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        {...props}
        className={cn(
          "text-[12.5px]",
          display === null
            ? "border-dashed text-muted-foreground"
            : "rounded-r-none border-r-0 pr-2",
        )}
      >
        {display === null ? (
          <>
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
            {label}
          </>
        ) : (
          <>
            <span className="text-muted-foreground">{label}</span>
            {display}
          </>
        )}
      </Button>
      {display !== null ? (
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="rounded-l-none"
          aria-label={`Clear ${label.toLowerCase()} filter`}
          onClick={onClear}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
        </Button>
      ) : null}
    </span>
  );
}

export function ResourceChip({
  options,
  value,
  onChange,
}: {
  options: ResourceOption[];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const selected = options.find((o) => o.id === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <ChipTrigger
            label="Resource"
            display={selected ? <span className="font-mono">{selected.name}</span> : null}
            onClear={() => onChange(undefined)}
          />
        }
      />
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Resources</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value ?? ""}
            onValueChange={(v) => onChange(v || undefined)}
          >
            {options.map((o) => (
              <DropdownMenuRadioItem key={o.id} value={o.id} className="font-mono text-[12.5px]">
                {o.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PersonChip({
  options,
  automaticCount,
  people,
  automatic,
  onChange,
}: {
  options: PersonOption[];
  automaticCount: number;
  people: readonly string[];
  automatic: boolean;
  onChange: (people: string[], automatic: boolean) => void;
}) {
  const count = people.length + (automatic ? 1 : 0);
  const value = count === 0 ? null : count === 1 ? (people[0] ?? "Automatic") : `${count} selected`;
  const toggle = (name: string, on: boolean) =>
    onChange(on ? [...people, name] : people.filter((p) => p !== name), automatic);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<ChipTrigger label="Person" display={value} onClear={() => onChange([], false)} />}
      />
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Triggered or pushed by</DropdownMenuLabel>
          {options.length === 0 ? (
            <p className="px-1.5 py-1 text-[12.5px] text-muted-foreground">
              Nobody in this window.
            </p>
          ) : null}
          {options.map((p) => (
            <DropdownMenuCheckboxItem
              key={p.name}
              checked={people.includes(p.name)}
              onCheckedChange={(on) => toggle(p.name, on)}
            >
              <ActorAvatar
                actor={{ kind: "person", name: p.name, image: p.image, via: "triggered" }}
                className="size-5"
              />
              <span className="truncate">{p.name}</span>
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">{p.count}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={automatic}
          onCheckedChange={(on) => onChange([...people], on)}
        >
          <ActorAvatar actor={{ kind: "automatic" }} className="size-5" />
          <span>
            Automatic <span className="text-muted-foreground">· API key, automation</span>
          </span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {automaticCount}
          </span>
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WindowChip({
  value,
  onChange,
}: {
  value: DeployWindow;
  onChange: (v: DeployWindow) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="text-[12.5px]">
            <HugeiconsIcon icon={Calendar03Icon} strokeWidth={2} />
            {windowLabel(value)}
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => {
            const next = DEPLOY_WINDOWS.find((w) => w.id === v);
            if (next) onChange(next.id);
          }}
        >
          {DEPLOY_WINDOWS.map((w) => (
            <DropdownMenuRadioItem key={w.id} value={w.id}>
              {w.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
