/**
 * Read-only Caddyfile viewer for the Networking tab. Renders the real
 * reconciler-generated config (not a client-side approximation) in a
 * full-height, internally-scrolling pane with a line-number gutter,
 * lightweight token coloring, copy-to-clipboard, and an in-file find bar
 * (Cmd/Ctrl+F) with match count + prev/next navigation.
 *
 * Not editable: the Caddyfile is owned by the reconciler and re-rendered
 * on every route change, so hand-edits would be clobbered. This is the
 * highlighted read surface; the Routes tab is where config is mutated.
 */

import { Fragment, useEffect, useRef, useState } from "react";

import { useHotkey } from "@tanstack/react-hotkeys";

import {
  buildModel,
  KIND_CLASS,
  type Segment,
} from "@/features/projects/components/networking/caddyfile-highlight";
import { CaddyfileToolbar } from "@/features/projects/components/networking/caddyfile-toolbar";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/components/ui/empty";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

export interface CaddyfileViewerProps {
  source: string;
  revision?: string;
  loading?: boolean;
  className?: string;
}

export function CaddyfileViewer({ source, revision, loading, className }: CaddyfileViewerProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const matchRefs = useRef(new Map<number, HTMLElement | null>());

  const { lines, total } = buildModel(source, query);

  // Reset the cursor to the first hit whenever the query (and thus the match
  // set) changes, so prev/next start from a sane position. Done in render via
  // the prev-value pattern rather than an effect, so it doesn't trigger an
  // extra render (and re-run the scroll effect below with a stale `active`).
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActive(0);
  }

  // Scroll the active match into view as the user steps through hits.
  useEffect(() => {
    if (total === 0) return;
    matchRefs.current.get(active)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [active, total, query]);

  // Cmd/Ctrl+F focuses the find bar — but only when *this* viewer is the
  // visible tab panel (hidden panels have a null offsetParent), so the
  // shortcut doesn't fight other mounted-but-hidden viewers.
  useHotkey("Mod+F", (event) => {
    if (rootRef.current?.offsetParent == null) return;
    event.preventDefault();
    inputRef.current?.focus();
    inputRef.current?.select();
  });

  const step = (dir: 1 | -1) => {
    if (total === 0) return;
    setActive((a) => (a + dir + total) % total);
  };

  const isEmpty = !loading && source.trim().length === 0;

  return (
    <div
      ref={rootRef}
      className={cn(
        // The layout chain doesn't pass a definite height down (SidebarProvider
        // is min-h-svh, not h-svh), so flex-fill can't reach the viewport
        // bottom — size against the viewport like EdgeLogsView does. Offset =
        // header + project tabs + page padding + the in-page tab strip.
        "flex h-[calc(100svh-var(--header-height)-9rem)] min-h-80 flex-col overflow-hidden rounded-xl border bg-muted/20",
        className,
      )}
    >
      <CaddyfileToolbar
        revision={revision}
        query={query}
        active={active}
        total={total}
        inputRef={inputRef}
        source={source}
        disabled={isEmpty}
        onQuery={setQuery}
        onStep={step}
      />

      {loading ? (
        <LoadingBody />
      ) : isEmpty ? (
        <EmptyBody />
      ) : (
        <CodeBody lines={lines} active={active} matchRefs={matchRefs} />
      )}
    </div>
  );
}

function CodeBody({
  lines,
  active,
  matchRefs,
}: {
  lines: Segment[][];
  active: number;
  matchRefs: React.RefObject<Map<number, HTMLElement | null>>;
}) {
  const gutterWidth = String(lines.length).length;
  return (
    <pre className="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[1.55]">
      <code className="block min-w-max px-3 py-2">
        {lines.map((segs, idx) => (
          <Fragment key={idx}>
            <span className="mr-4 inline-block text-right text-muted-foreground/40 tabular-nums select-none">
              {String(idx + 1).padStart(gutterWidth, " ")}
            </span>
            {segs.map((seg, i) =>
              seg.match !== undefined ? (
                <span
                  key={i}
                  ref={(el) => {
                    matchRefs.current.set(seg.match as number, el);
                  }}
                  className={cn(
                    "rounded-xs",
                    seg.match === active ? "bg-amber-400/50 text-foreground" : "bg-amber-400/20",
                    KIND_CLASS[seg.kind],
                  )}
                >
                  {seg.text}
                </span>
              ) : (
                <span key={i} className={KIND_CLASS[seg.kind]}>
                  {seg.text}
                </span>
              ),
            )}
            {"\n"}
          </Fragment>
        ))}
      </code>
    </pre>
  );
}

function LoadingBody() {
  return (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${40 + ((i * 13) % 50)}%` }} />
      ))}
    </div>
  );
}

function EmptyBody() {
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyTitle>No routes contribute to the Caddyfile yet</EmptyTitle>
        <EmptyDescription>
          Enable a route on the Routes tab to see its generated HTTP / Layer4 blocks here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
