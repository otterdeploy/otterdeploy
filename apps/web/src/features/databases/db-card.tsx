import type { ProjectSlug } from "@otterdeploy/shared/id";

/**
 * One database in the org catalog: engine brand tile, mono name, version +
 * project badges, runtime status pill, a three-stat row (storage, connections,
 * last backup), the internal endpoint with one-click connection-string copy,
 * and Open (graph panel) / Backups actions. Every stat degrades to "—" when
 * the probe couldn't measure it — no invented numbers.
 */
import { useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { copyToClipboard } from "@/shared/lib/clipboard";

import type { CatalogDatabase } from "./data";

import { StatusPill, fmtBytes, relTime } from "./shared";

export function DatabaseCard({ db, orgSlug }: { db: CatalogDatabase; orgSlug: string }) {
  // Live server version beats the image tag; the tag is the honest fallback.
  const version = db.stats?.serverVersion ?? db.version;
  const unreachable = db.runtimeStatus === "unreachable";

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-background">
          <DatabaseLogo value={db.engine} size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-mono text-sm font-medium">{db.name}</span>
            {version && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {version}
              </Badge>
            )}
            <Link
              to="/$orgSlug/$projectSlug"
              // Same brand-cast idiom as project-card.tsx — the wire slug is a
              // plain string, the route param is the branded Slug<"project">.
              params={{ orgSlug, projectSlug: db.projectSlug as ProjectSlug }}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {db.projectSlug}
            </Link>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {db.engineLabel}
            {db.publicEnabled && db.publicHostname ? (
              <>
                {" "}
                <span className="text-muted-foreground/50">·</span> public:{" "}
                <span className="font-mono">{db.publicHostname}</span>
              </>
            ) : null}
          </div>
        </div>
        <StatusPill status={db.runtimeStatus} />
      </div>

      <DbStats db={db} />
      {unreachable && (
        <p className="mt-1.5 text-xs text-warning">
          Runtime could not be reached — stats unavailable.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 border-t pt-3">
        <span className="shrink-0 text-xs text-muted-foreground">Internal</span>
        <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground/80">
          {db.internalHostname}:{db.internalPort}
        </code>
        <CopyConnectionString value={db.internalConnectionString} />
        <div className="flex-1" />
        <Button
          size="sm"
          variant="outline"
          render={
            <Link
              to="/$orgSlug/$projectSlug/graph/$resourceId"
              params={{
                orgSlug,
                projectSlug: db.projectSlug as ProjectSlug,
                resourceId: db.resourceId,
              }}
            />
          }
        >
          Open
        </Button>
        <Button
          size="sm"
          variant="ghost"
          render={<Link to="/$orgSlug/backups" params={{ orgSlug }} />}
        >
          Backups
        </Button>
      </div>
    </div>
  );
}

/** The three-stat row (storage, connections, last backup) — every value
 *  degrades to "—" when the probe couldn't measure it. */
function DbStats({ db }: { db: CatalogDatabase }) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-4 border-t pt-3">
      <Stat
        label="Storage"
        value={fmtBytes(db.stats?.sizeBytes ?? null)}
        sub={db.engine === "redis" ? "memory used" : "data size"}
      />
      <Stat
        label="Connections"
        value={db.stats?.connections != null ? String(db.stats.connections) : "—"}
        sub={db.stats?.maxConnections != null ? `of ${db.stats.maxConnections}` : ""}
      />
      <Stat
        label="Last backup"
        value={relTime(db.lastBackupAt)}
        sub={
          db.lastBackupStatus === null
            ? "never backed up"
            : db.lastBackupStatus === "succeeded"
              ? ""
              : `latest attempt: ${db.lastBackupStatus}`
        }
        subTone={
          db.lastBackupStatus !== null && db.lastBackupStatus !== "succeeded"
            ? "text-destructive"
            : undefined
        }
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  subTone,
}: {
  label: string;
  value: string;
  sub: string;
  subTone?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-medium tracking-[0.16em] text-muted-foreground/70 uppercase">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-base font-semibold">{value}</div>
      <div className={`truncate text-[11px] ${subTone ?? "text-muted-foreground"}`}>
        {sub || " "}
      </div>
    </div>
  );
}

/** Copies the FULL internal connection string (with credentials), not just the
 *  displayed host:port — that's the paste-into-an-app value. */
function CopyConnectionString({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    void copyToClipboard(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      onClick={onCopy}
      aria-label={copied ? "Copied" : "Copy connection string"}
      title="Copy connection string"
    >
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} className="size-3" />
    </Button>
  );
}
