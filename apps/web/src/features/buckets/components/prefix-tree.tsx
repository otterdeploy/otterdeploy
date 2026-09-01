import type { FileTreeDirectoryHandle, FileTreeItemHandle } from "@pierre/trees";

/**
 * The bucket tree, on `@pierre/trees`.
 *
 * S3 has no folder tree — only "list keys under a prefix, grouped at the next
 * `/`" — so this tree is built the only honest way: lazily. Every prefix
 * starts as an explicit, empty, collapsed folder; expanding it runs ONE
 * delimiter listing and adds what it found — sub-prefixes as folders and the
 * objects at that level as files. What you opened stays open, and nothing
 * is ever recomputed from where you happen to be standing.
 *
 * The tree is an editor of the same URL state as the breadcrumb and the
 * listing: picking a folder navigates, picking a file opens its preview, and
 * navigating from anywhere else reveals the path here.
 */
import { useEffect, useRef } from "react";

import { FileTree, useFileTree } from "@pierre/trees/react";
import { Result } from "better-result";

import { orpc } from "@/shared/server/orpc";

import { ancestorPrefixes } from "../state";

/** The handle union is discriminated by a method, which TS cannot narrow on
 *  its own; a real guard keeps `expand()` off file handles. */
const isDirectory = (item: FileTreeItemHandle): item is FileTreeDirectoryHandle =>
  item.isDirectory();

/** A directory path in the tree always carries its trailing slash. */
const dir = (path: string): string => (path.endsWith("/") ? path : `${path}/`);

/**
 * Folder icons in place of the library's chevron, drawn into its shadow DOM.
 *
 * A folder should look like a folder, and open should look open. The library
 * only rotates one chevron glyph, so the chevron is hidden and the icon lane
 * gets a masked folder shape keyed off the row's `aria-expanded`.
 */
const svgMask = (paths: string): string =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${paths}</svg>`,
  )}")`;
const FOLDER_CLOSED = svgMask(
  '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
);
const FOLDER_OPEN = svgMask(
  '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5V11"/><path d="M3 17.5V11h17.2a1.5 1.5 0 0 1 1.4 2l-1.9 5.5a2 2 0 0 1-1.9 1.5H5.5A2.5 2.5 0 0 1 3 17.5z"/>',
);
const FOLDER_ICON_CSS = `
[data-item-type="folder"] > [data-item-section="icon"] > [data-icon-name="file-tree-icon-chevron"] { display: none; }
[data-item-type="folder"] > [data-item-section="icon"]::before {
  content: ""; display: block; width: 14px; height: 14px; background: currentColor; opacity: .85;
  -webkit-mask: ${FOLDER_CLOSED} center / contain no-repeat; mask: ${FOLDER_CLOSED} center / contain no-repeat;
}
[data-item-type="folder"][aria-expanded="true"] > [data-item-section="icon"]::before {
  -webkit-mask-image: ${FOLDER_OPEN}; mask-image: ${FOLDER_OPEN};
}`;

export function PrefixTree({
  bucketId,
  activePrefix,
  onNavigate,
  onPickObject,
}: {
  bucketId: string;
  activePrefix: string;
  onNavigate: (prefix: string) => void;
  onPickObject: (key: string) => void;
}) {
  // The model is created once; callbacks it captured must read live values.
  const activeRef = useRef(activePrefix);
  const navigateRef = useRef(onNavigate);
  const pickRef = useRef(onPickObject);
  useEffect(() => {
    activeRef.current = activePrefix;
    navigateRef.current = onNavigate;
    pickRef.current = onPickObject;
  });

  const { model } = useFileTree({
    paths: [],
    // An unloaded prefix IS an empty directory until it is expanded; flattening
    // would fold it into its parent's label and hide the affordance that loads it.
    flattenEmptyDirectories: false,
    density: "compact",
    icons: "standard",
    unsafeCSS: FOLDER_ICON_CSS,
    onSelectionChange: (paths) => {
      const picked = paths[0];
      if (picked === undefined) return;
      if (!picked.endsWith("/")) {
        pickRef.current(picked);
        return;
      }
      // Programmatic reveal selects the active prefix; that must not navigate
      // again, or every breadcrumb click would also reset paging and preview.
      if (picked === activeRef.current) return;
      navigateRef.current(picked);
    },
  });

  // ── lazy loading: one listing per expanded directory, once ──────────────
  const loaded = useRef(new Set<string>());
  const loading = useRef(new Set<string>());

  useEffect(() => {
    const load = async (prefix: string) => {
      if (loaded.current.has(prefix) || loading.current.has(prefix)) return;
      loading.current.add(prefix);
      const listed = await Result.tryPromise({
        try: () =>
          orpc.storage.list.call({
            bucketId,
            prefix,
            grouping: "folders",
            continuationToken: null,
            maxKeys: 1000,
          }),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      });
      loading.current.delete(prefix);
      loaded.current.add(prefix);
      if (listed.isErr()) return;
      const paths = [...listed.value.prefixes.map(dir), ...listed.value.objects.map((o) => o.key)];
      const ops = paths
        .filter((p) => model.getItem(p) === null)
        .map((path) => ({ type: "add" as const, path }));
      if (ops.length > 0) model.batch(ops);
    };

    void load("");
    // Expansion has no event of its own; the model notifies on every change
    // and the visible rows say which directories are open.
    return model.subscribe(() => {
      const rows = model.getVisibleRows(0, model.getVisibleCount());
      for (const row of rows) {
        if (row.kind === "directory" && row.isExpanded) void load(dir(row.path));
      }
    });
  }, [model, bucketId]);

  // ── reveal: the URL changed elsewhere, so the tree shows the path ──────
  useEffect(() => {
    const chain = ancestorPrefixes(activePrefix);
    const missing = chain
      .filter((p) => model.getItem(p) === null)
      .map((path) => ({ type: "add" as const, path }));
    if (missing.length > 0) model.batch(missing);

    for (const p of chain) {
      const item = model.getItem(p);
      if (item !== null && isDirectory(item)) item.expand();
    }
    const leaf = chain.at(-1);
    if (leaf === undefined) {
      for (const p of model.getSelectedPaths()) model.getItem(p)?.deselect();
      return;
    }
    const item = model.getItem(leaf);
    if (item && !item.isSelected()) item.select();
    model.scrollToPath(leaf, { offset: "nearest" });
  }, [model, activePrefix]);

  return (
    <FileTree
      model={model}
      aria-label="Bucket contents"
      className="block min-h-0 flex-1 overflow-hidden [--trees-accent:var(--primary)] [--trees-bg:transparent] [--trees-border-color:transparent] [--trees-border-radius-override:5px] [--trees-fg-muted:var(--muted-foreground)] [--trees-fg:var(--foreground)] [--trees-focus-ring-width-override:0px] [--trees-font-family:var(--font-mono)] [--trees-font-size:11.5px] [--trees-icon-gray:var(--muted-foreground)] [--trees-icon-width-override:14px] [--trees-item-height:26px] [--trees-item-padding-x-override:6px] [--trees-item-row-gap-override:5px] [--trees-level-gap-override:12px] [--trees-padding-inline-override:6px] [--trees-selected-focused-border-color-override:transparent] [--trees-theme-focus-ring:transparent] [--trees-theme-list-active-selection-bg:var(--muted)] [--trees-theme-list-active-selection-fg:var(--foreground)] [--trees-theme-list-hover-bg:var(--muted)]"
    />
  );
}
