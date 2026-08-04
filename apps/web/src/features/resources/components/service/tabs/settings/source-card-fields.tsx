/**
 * Presentational field pieces + form-state hook for the service Source card.
 * Split out of source-card.tsx to keep that file under the max-lines cap (same
 * reason the deploy wizard splits source-pickers.tsx out of source.tsx). The
 * pickers reuse the deploy wizard's components — app Select (not native) for the
 * installation, a searchable Combobox for the repository.
 */

import { GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { repoWebUrl } from "@/features/resources/lib/repo-url";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/shared/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Spinner } from "@/shared/components/ui/spinner";
import { Switch } from "@/shared/components/ui/switch";

/** Installation picker — the app Select (Base UI), mirroring the deploy wizard. */
export function InstallationField({
  installations,
  value,
  onChange,
}: {
  installations: { id: string; label: string }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  if (installations.length === 0) {
    return (
      <p className="text-[11.5px] text-muted-foreground">
        No git installations connected — connect one in Settings → Git providers.
      </p>
    );
  }
  return (
    <Select
      value={value ?? ""}
      onValueChange={(v) => v && onChange(v)}
      items={installations.map((row) => ({ label: row.label, value: row.id }))}
    >
      <SelectTrigger className="h-8 text-[12.5px]">
        <SelectValue placeholder="Choose an installation" />
      </SelectTrigger>
      <SelectContent>
        {installations.map((row) => (
          <SelectItem key={row.id} value={row.id} className="text-[12.5px]">
            {row.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Repository picker — a searchable Combobox, mirroring the deploy wizard. */
/** Opens the selected repository on its provider. Rendered beside the picker so
 *  "which repo does this build from?" and "take me to it" are the same glance —
 *  previously the name was shown but there was no way through to the source. */
function RepoSourceLink({ kind, fullName }: { kind: string | null; fullName: string }) {
  const href = repoWebUrl(kind, fullName);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${fullName} on ${kind}`}
      aria-label={`Open ${fullName} on ${kind}`}
      className="group inline-flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
    >
      <HugeiconsIcon icon={GithubIcon} strokeWidth={1.8} className="size-4" />
    </a>
  );
}

export function RepositoryField({
  activeInstallationId,
  installationKind,
  isLoading,
  options,
  value,
  onChange,
}: {
  activeInstallationId: string | null;
  /** Provider of the selected installation ("github"), for the source link. */
  installationKind: string | null;
  isLoading: boolean;
  options: string[];
  value: string;
  onChange: (repo: string) => void;
}) {
  if (activeInstallationId == null) {
    return <p className="text-[11.5px] text-muted-foreground">Pick an installation first.</p>;
  }
  if (isLoading) {
    return (
      <div className="flex h-8 items-center gap-2 rounded-md border bg-muted/20 px-3 text-[12px] text-muted-foreground">
        <Spinner className="size-3.5" />
        Loading repositories…
      </div>
    );
  }
  if (options.length === 0) {
    return (
      <p className="text-[11.5px] text-muted-foreground">
        No repositories accessible for this installation.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <Combobox items={options} value={value} onValueChange={(v) => v && onChange(v)}>
          <ComboboxInput
            placeholder="Search repositories…"
            className="h-8 font-mono text-[12.5px]"
          />
          <ComboboxContent>
            <ComboboxEmpty>No matching repositories.</ComboboxEmpty>
            <ComboboxList>
              {(fullName: string) => (
                <ComboboxItem key={fullName} value={fullName} className="font-mono text-[12.5px]">
                  {fullName}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>
      <RepoSourceLink kind={installationKind} fullName={value} />
    </div>
  );
}

/** PR-previews opt-in switch — per service, staged into the manifest like the
 *  rest of the source block. */
export function PreviewsField({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex h-8 items-center">
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
