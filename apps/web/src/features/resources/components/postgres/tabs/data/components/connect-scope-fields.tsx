/**
 * The connect form's scope block: environment, visibility and transport.
 *
 * Split from connect-form.tsx so each file stays one screen you can read
 * whole; the dialog still owns every piece of state and this only renders it.
 */
import { Checkbox } from "@/shared/components/ui/checkbox";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";

import type { ConnectDraft } from "./connect-form";

/**
 * The choices behind the two scope selects, with what each one means.
 *
 * `items` is handed to the Select as well as rendered: Base UI's `Value`
 * prints the raw value ("other", "org") unless it is told the labels, which
 * is exactly what the trigger used to show.
 */
const ENVIRONMENTS: readonly {
  value: ConnectDraft["environment"];
  label: string;
  hint: string;
}[] = [
  { value: "other", label: "Not production", hint: "Writes allowed from the workbench." },
  { value: "production", label: "Production", hint: "Always opens read-only." },
];

const VISIBILITIES: readonly {
  value: ConnectDraft["visibility"];
  label: string;
  hint: string;
}[] = [
  { value: "org", label: "Everyone in this org", hint: "Every member can open it." },
  { value: "private", label: "Only me", hint: "Listed for you alone." },
];

/**
 * How the connection is used: environment, visibility and transport.
 *
 * One block, one rhythm. The two selects fill their columns so their edges
 * line up with the inputs above; each carries a one-line consequence under
 * it, because "Production" is a policy (read-only, always) and the reader
 * should not have to open the menu to learn that. TLS is a third setting of
 * the same kind, so it sits in the same block with the same label/hint pair,
 * rather than as a trailing one-liner.
 */
export function ScopeFields({
  draft,
  patch,
}: {
  draft: ConnectDraft;
  patch: (next: Partial<ConnectDraft>) => void;
}) {
  const environment = ENVIRONMENTS.find((e) => e.value === draft.environment) ?? ENVIRONMENTS[0];
  const visibility = VISIBILITIES.find((v) => v.value === draft.visibility) ?? VISIBILITIES[0];
  return (
    <div className="flex flex-col gap-3 border-t pt-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conn-environment">Environment</Label>
          <Select
            items={ENVIRONMENTS}
            value={draft.environment}
            onValueChange={(v) => patch({ environment: v === "production" ? v : "other" })}
          >
            <SelectTrigger id="conn-environment" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENVIRONMENTS.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11.5px] leading-snug text-muted-foreground">{environment.hint}</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="conn-visibility">Visible to</Label>
          <Select
            items={VISIBILITIES}
            value={draft.visibility}
            onValueChange={(v) => patch({ visibility: v === "private" ? v : "org" })}
          >
            <SelectTrigger id="conn-visibility" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VISIBILITIES.map((v) => (
                <SelectItem key={v.value} value={v.value}>
                  {v.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11.5px] leading-snug text-muted-foreground">{visibility.hint}</p>
        </div>
      </div>

      <div className="flex items-start gap-2.5">
        <Checkbox
          id="conn-tls"
          className="mt-0.5"
          checked={draft.requireTls}
          onCheckedChange={(v) => patch({ requireTls: Boolean(v) })}
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="conn-tls">Require TLS</Label>
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            The hop leaves the cluster. Leave this on unless the server cannot speak TLS.
          </p>
        </div>
      </div>
    </div>
  );
}
