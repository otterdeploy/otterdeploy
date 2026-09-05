/**
 * Which machine a compose stack runs on, chosen at install rather than
 * discovered afterwards.
 *
 * The whole stack, not one service: its children reach each other over the
 * project network, so splitting them across boxes is a mesh question rather
 * than something an install form should decide by accident. A single child can
 * still be moved later from its own Settings tab, which stays the only surface
 * that CHANGES placement.
 *
 * Hidden entirely when there is one machine or none. A picker with a single
 * option is not a choice, and rendering it implies a decision the operator
 * does not have to make. This is the same reasoning `placement-pin.tsx` uses
 * to hide itself on plain docker.
 *
 * The value is the server NAME, not its id: it is staged into the manifest,
 * which is portable across installs where the name survives and the id does
 * not (see `server` in stack/manifest/schema.ts).
 */

import { useLiveQuery } from "@tanstack/react-db";

import { serverCollection } from "@/features/servers/data/server";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import type { ComposeForm } from "./compose-wizard-shared";

/** Sentinel for "no pin": Select cannot carry an empty value. Mirrors
 *  `placement-pin.tsx`'s ANYWHERE. */
const ANYWHERE = "__anywhere__";

export function ComposeServerField({ form }: { form: ComposeForm }) {
  const { data: servers = [] } = useLiveQuery(() => serverCollection);
  // A dedicated build server exists to build; a box sized for builds should
  // not quietly start serving traffic too. Same filter as placement-pin.tsx.
  const candidates = servers.filter((s) => !s.buildServer);
  if (candidates.length < 2) return null;

  return (
    <form.Field name="file.serverName">
      {(field) => (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Server <span className="text-muted-foreground/60">(optional)</span>
          </span>
          <Select
            value={field.state.value === "" ? ANYWHERE : field.state.value}
            onValueChange={(v) => field.handleChange(v === null || v === ANYWHERE ? "" : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANYWHERE}>Any server (scheduler decides)</SelectItem>
              {candidates.map((s) => (
                <SelectItem key={s.id} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground/80">
            Every service in this stack starts here. Move one later from its own Settings tab.
          </span>
        </label>
      )}
    </form.Field>
  );
}
