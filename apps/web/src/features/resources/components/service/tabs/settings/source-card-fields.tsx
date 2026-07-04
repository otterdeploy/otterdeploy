/**
 * Presentational field pieces + form-state hook for the service Source card.
 * Split out of source-card.tsx to keep that file under the max-lines cap (same
 * reason the deploy wizard splits source-pickers.tsx out of source.tsx). The
 * pickers reuse the deploy wizard's components — app Select (not native) for the
 * installation, a searchable Combobox for the repository.
 */

import { useEffect, useState } from "react";

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

/** The saved manifest source block this card edits (subset we read). */
interface GitSourceBlock {
  repo?: string | null;
  branch?: string | null;
  sourceSubdir?: string | null;
  imageRepository?: string | null;
}

export interface SourceForm {
  repo: string;
  branch: string;
  root: string;
  image: string;
  setRepo: (v: string) => void;
  setBranch: (v: string) => void;
  setRoot: (v: string) => void;
  setImage: (v: string) => void;
  dirty: boolean;
}

/** Local edit state seeded from the saved source block, plus a dirty flag. */
export function useSourceForm(gitSvc: GitSourceBlock | null): SourceForm {
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [root, setRoot] = useState("");
  const [image, setImage] = useState("");

  useEffect(() => {
    setRepo(gitSvc?.repo ?? "");
    setBranch(gitSvc?.branch ?? "");
    setRoot(gitSvc?.sourceSubdir ?? "");
    setImage(gitSvc?.imageRepository ?? "");
  }, [gitSvc]);

  const dirty =
    repo !== (gitSvc?.repo ?? "") ||
    branch !== (gitSvc?.branch ?? "") ||
    root !== (gitSvc?.sourceSubdir ?? "") ||
    image !== (gitSvc?.imageRepository ?? "");

  return { repo, branch, root, image, setRepo, setBranch, setRoot, setImage, dirty };
}

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
export function RepositoryField({
  activeInstallationId,
  isLoading,
  options,
  value,
  onChange,
}: {
  activeInstallationId: string | null;
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
    <Combobox items={options} value={value} onValueChange={(v) => v && onChange(v)}>
      <ComboboxInput placeholder="Search repositories…" className="h-8 font-mono text-[12.5px]" />
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
  );
}
