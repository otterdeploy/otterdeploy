/**
 * The connect dialog's two bodies: the engine grid (step 1) and the
 * per-connection form (step 2). Split from the dialog so each screen stays a
 * component you can read whole; the dialog owns every piece of state and these
 * only render it.
 */
import type { ChangeEvent } from "react";

import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";

import type { DataConnection } from "../data/connections";
import type { ConnectEngine, UrlFields } from "./connect-engines";

import { COMING_SOON, CONNECT_ENGINES } from "./connect-engines";
import { ScopeFields } from "./connect-scope-fields";
import { TagsField } from "./connect-tags-field";

export interface ConnectDraft {
  name: string;
  /** The pasted URL; wins over the discrete fields when both are present. */
  url: string;
  fields: UrlFields;
  visibility: DataConnection["visibility"];
  environment: DataConnection["environment"];
  requireTls: boolean;
  /** Canonical already: the tags field normalises on the way in. */
  tags: string[];
}

/** Step 1: the engine grid, with paste-to-autodetect above it. */
export function EnginePicker({
  onAcceptUrl,
  onPick,
}: {
  onAcceptUrl: (raw: string) => void;
  onPick: (engine: ConnectEngine) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Input
        autoFocus
        type="password"
        autoComplete="off"
        placeholder="protocol://user:password@host:port/database"
        className="font-mono text-[12px]"
        onChange={(e) => onAcceptUrl(e.target.value)}
      />
      <p className="text-[12px] text-muted-foreground">
        Paste a connection string to detect the engine and fill the form.
      </p>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
        <span className="h-px flex-1 bg-border" />
        or pick the engine
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {CONNECT_ENGINES.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onPick(e)}
            className="flex h-12 items-center justify-center gap-2.5 rounded-md border text-[13px] font-medium transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <DatabaseLogo value={e.id} size={22} />
            {e.label}
          </button>
        ))}
        {COMING_SOON.map((label) => (
          <div
            key={label}
            aria-disabled
            className="flex h-12 items-center justify-center gap-2 rounded-md border border-dashed text-[13px] text-muted-foreground/50"
          >
            <span className="opacity-60">
              <DatabaseLogo value={label} size={20} />
            </span>
            {label}
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] tracking-wide uppercase">
              soon
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Step 2: the per-connection form. */
export function ConnectForm({
  engine,
  draft,
  editing,
  error,
  tested,
  tagSuggestions,
  patch,
  onAcceptUrl,
  onBack,
}: {
  engine: ConnectEngine;
  draft: ConnectDraft;
  editing: boolean;
  error: string | null;
  tested: string | null;
  /** Tags already used by the org's other connections. */
  tagSuggestions: readonly string[];
  patch: (next: Partial<ConnectDraft>) => void;
  onAcceptUrl: (raw: string) => void;
  onBack?: () => void;
}) {
  const field = (key: keyof UrlFields) => ({
    value: draft.fields[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) =>
      patch({ fields: { ...draft.fields, [key]: e.target.value } }),
  });

  return (
    <div className="flex flex-col gap-3">
      {onBack !== undefined ? (
        <button
          type="button"
          onClick={onBack}
          className="self-start text-[12px] text-muted-foreground hover:text-foreground"
        >
          ← All engines
        </button>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="conn-name">Name</Label>
        <Input
          id="conn-name"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="neon-analytics"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="conn-url">
          Connection URL{editing ? " (leave blank to keep the current one)" : ""}
        </Label>
        <Input
          id="conn-url"
          type="password"
          autoComplete="off"
          value={draft.url}
          onChange={(e) => onAcceptUrl(e.target.value)}
          placeholder={engine.placeholder}
          className="font-mono text-[12px]"
        />
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground/70">
        <span className="h-px flex-1 bg-border" />
        or fill in the pieces
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="flex gap-3">
        <div className="flex flex-[3] flex-col gap-1.5">
          <Label htmlFor="conn-host">Host</Label>
          <Input id="conn-host" placeholder="db.example.com" {...field("host")} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="conn-port">Port</Label>
          <Input
            id="conn-port"
            inputMode="numeric"
            placeholder={String(engine.port)}
            {...field("port")}
          />
        </div>
      </div>
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="conn-user">User</Label>
          <Input id="conn-user" autoComplete="off" {...field("user")} />
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="conn-password">Password</Label>
          <Input
            id="conn-password"
            type="password"
            autoComplete="new-password"
            {...field("password")}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="conn-database">Database</Label>
        <Input
          id="conn-database"
          placeholder={engine.id === "postgres" ? "postgres" : "mysql"}
          {...field("database")}
        />
      </div>

      <ScopeFields draft={draft} patch={patch} />

      <TagsField
        tags={draft.tags}
        suggestions={tagSuggestions}
        onChange={(tags) => patch({ tags })}
      />

      {tested !== null ? (
        <p className="rounded-md bg-success/10 px-3 py-2 text-[12.5px] text-success">{tested}</p>
      ) : null}
      {error !== null ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
