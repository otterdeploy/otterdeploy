/**
 * Reference picker dropdown — the Railway-style "Add Reference" surface
 * for the env-var editor.
 *
 * Reads from `project.refs.list` and renders one row per available
 * `${{Source.KEY}}` token in the project. The user picks a row; we
 * return the token string to the caller, which inserts it at the
 * cursor in the associated value field.
 *
 * Narrowing works two ways: the text input substring-matches `key`,
 * `sourceName` or the full token, and a horizontally scrollable chip bar
 * (one chip per source) filters to a single resource with a tap.
 * Presentational pieces + grouping live in `./reference-picker-parts`.
 */

import { useState, useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { buildRefGroups, buildRefSources, SourceChip, SourceIcon } from "./reference-picker-parts";

export interface ReferencePickerProps {
  /** Accepts either a branded project id or the plain string the
   *  caller has on hand — branded types are launder via `as never` at
   *  the query-options call so both shapes work. */
  projectId: string;
  /** Hide the row whose token equals this — used when the picker is
   *  opened from a field whose value already IS one specific token. */
  excludeToken?: string | null;
  /** Called once the user clicks a row. Receives the token to insert. */
  onPick: (token: string) => void;
  /** Optional close-the-picker callback for parent UIs that render the
   *  picker as a popover/menu. */
  onClose?: () => void;
  className?: string;
}

export function ReferencePicker({
  projectId,
  excludeToken,
  onPick,
  onClose,
  className,
}: ReferencePickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  /** Tap-to-filter source chip — a group key, or null for all sources. */
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  const { data: refs = [], isLoading } = useQuery(
    orpc.project.refs.list.queryOptions({
      input: { projectId },
    }),
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = excludeToken ? refs.filter((r) => r.token !== excludeToken) : refs;
    if (sourceFilter !== null)
      base = base.filter((r) => `${r.sourceKind}:${r.sourceName}` === sourceFilter);
    if (q.length === 0) return base;
    return base.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.sourceName.toLowerCase().includes(q) ||
        r.token.toLowerCase().includes(q),
    );
  }, [query, refs, excludeToken, sourceFilter]);

  const groups = useMemo(() => buildRefGroups(filtered), [filtered]);

  // Chip bar sources come from the FULL ref list (before text/source
  // filtering) so the chips never vanish while one of them is active.
  const sources = useMemo(() => buildRefSources(refs), [refs]);

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-md border bg-popover shadow-md",
        className,
      )}
    >
      <div className="border-b p-2">
        <input
          type="text"
          placeholder={t("refPicker.filterPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose?.();
          }}
          className="h-7 w-full bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      {/* Tap-to-filter source chips — horizontally scrollable, one per
          source, so narrowing to one resource is a tap instead of typing. */}
      {sources.length > 1 && (
        <div className="flex [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b px-2 py-1.5">
          <SourceChip
            active={sourceFilter === null}
            onClick={() => setSourceFilter(null)}
            label={t("refPicker.all")}
          />
          {sources.map((s) => (
            <SourceChip
              key={s.key}
              active={sourceFilter === s.key}
              onClick={() => setSourceFilter(sourceFilter === s.key ? null : s.key)}
              label={s.label}
              icon={<SourceIcon kind={s.kind} engine={s.engine} vaultKind={s.vaultKind} />}
            />
          ))}
        </div>
      )}
      <div className="max-h-[320px] overflow-y-auto py-1">
        {isLoading ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {t("refPicker.loading")}
          </div>
        ) : groups.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            {query || sourceFilter ? t("refPicker.noMatches") : t("refPicker.noRefs")}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.key} className="mb-1 last:mb-0">
              {/* Group header names the owner — a resource, or the shared
                  project/environment scope — so each token's origin is clear. */}
              <div className="flex items-center gap-2 px-3 py-1.5">
                <SourceIcon kind={g.kind} engine={g.engine} vaultKind={g.vaultKind} />
                <span className="text-[11.5px] font-semibold text-foreground">{g.label}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[9.5px] tracking-wide text-muted-foreground uppercase">
                  {t(g.subKey)}
                </span>
              </div>
              {g.items.map((r) => (
                <button
                  key={r.token}
                  type="button"
                  onClick={() => {
                    onPick(r.token);
                    onClose?.();
                  }}
                  className="flex w-full items-center gap-2 py-1.5 pr-3 pl-9 text-left hover:bg-accent/40"
                >
                  <span className="font-mono text-[11.5px]">{r.key}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {/* Platform-generated (HOST/PORT/URL/DOMAIN/DATABASE_URL/…)
                        vs the service's own env keys — tagged so they're not
                        mistaken for each other. */}
                    {r.platform && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] tracking-wide text-muted-foreground/70 uppercase">
                        {t("refPicker.platform")}
                      </span>
                    )}
                    {r.isSecret && (
                      <span className="text-[10px] text-muted-foreground/70">
                        {t("refPicker.secret")}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
