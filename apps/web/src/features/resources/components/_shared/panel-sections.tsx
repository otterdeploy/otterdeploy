/**
 * The sections of whatever tab is open, so the rail can be a table of contents.
 *
 * Expanded, a Settings tab is a long scroll — Identity, Scaling, Health check,
 * Networking, Danger zone — and the rail beside it was showing seven words and
 * a lot of empty. That empty is what this fills: the same list a docs sidebar
 * shows, with the section you are actually looking at marked as you scroll.
 *
 * Nothing has to be wired per tab. `SettingsCard` registers itself, so every
 * settings surface in every panel kind gets its contents listed for free, in
 * document order, and a card added later shows up without anyone remembering
 * to add it here.
 *
 * The registry is a plain store read through `useSyncExternalStore` rather than
 * state updated from a child's effect: a dozen cards registering on mount would
 * otherwise be a dozen cascading renders of the whole panel.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";

export interface PanelSection {
  id: string;
  title: string;
  element: HTMLElement;
}

class SectionRegistry {
  /** Bumped on every change; the snapshot React compares. */
  version = 0;
  sections: PanelSection[] = [];
  activeId: string | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  private notify(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  register(section: PanelSection): void {
    this.sections = [...this.sections.filter((s) => s.id !== section.id), section].sort((a, b) =>
      // Document order, not mount order: React mounts children in order but a
      // conditionally-rendered card can arrive late, and a table of contents
      // in the wrong order is worse than none.
      a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    if (!this.activeId) this.activeId = this.sections[0]?.id ?? null;
    this.notify();
  }

  unregister(id: string): void {
    this.sections = this.sections.filter((s) => s.id !== id);
    if (this.activeId === id) this.activeId = this.sections[0]?.id ?? null;
    this.notify();
  }

  setActive(id: string | null): void {
    if (this.activeId === id) return;
    this.activeId = id;
    this.notify();
  }
}

interface SectionsValue {
  registry: SectionRegistry;
  /** The pane's scroll container: the observer's root, and what a click
   *  scrolls. Null until the layout mounts. */
  scrollRef: RefObject<HTMLElement | null>;
}

const SectionsContext = createContext<SectionsValue | null>(null);

export function PanelSectionsProvider({
  children,
  scrollRef,
}: {
  children: ReactNode;
  scrollRef: RefObject<HTMLElement | null>;
}) {
  // useState's lazy initialiser, not a ref: the registry has to be read
  // during render to build the context value, and a ref read there is exactly
  // what `react-hooks/refs` forbids. One instance per provider either way.
  const [registry] = useState(() => new SectionRegistry());

  return (
    <SectionsContext.Provider value={{ registry, scrollRef }}>{children}</SectionsContext.Provider>
  );
}

/** Register one section. Returns the ref to put on its element. */
export function usePanelSection(title: string): (element: HTMLElement | null) => void {
  const ctx = useContext(SectionsContext);
  const id = sectionId(title);
  return useCallback(
    (element: HTMLElement | null) => {
      if (!ctx) return;
      if (element) ctx.registry.register({ id, title, element });
      else ctx.registry.unregister(id);
    },
    [ctx, id, title],
  );
}

/** The sections of the open tab, the one in view, and how to reach one. */
export function usePanelSections(): {
  sections: PanelSection[];
  activeId: string | null;
  goTo: (id: string) => void;
} {
  const ctx = useContext(SectionsContext);
  const registry = ctx?.registry;
  useSyncExternalStore(registry?.subscribe ?? noopSubscribe, registry?.getSnapshot ?? zero, zero);

  // Mark the section nearest the top of the pane. `rootMargin` pulls the
  // trigger line down from the very top so a heading counts as "here" while
  // its body is still what fills the view, which is how a reader thinks about
  // it — and the bottom inset stops the last short section from never winning.
  useEffect(() => {
    if (!ctx) return;
    const root = ctx.scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0]?.target;
        if (!(first instanceof HTMLElement)) return;
        const match = ctx.registry.sections.find((section) => section.element === first);
        if (match) ctx.registry.setActive(match.id);
      },
      { root, rootMargin: "-12% 0px -70% 0px", threshold: 0 },
    );
    for (const section of ctx.registry.sections) observer.observe(section.element);
    return () => {
      observer.disconnect();
    };
    // Re-observe whenever the section set changes (a tab switch replaces them).
  }, [ctx, ctx?.registry.version]);

  const goTo = useCallback(
    (id: string) => {
      const section = ctx?.registry.sections.find((s) => s.id === id);
      if (!section) return;
      section.element.scrollIntoView({ behavior: "smooth", block: "start" });
      // Mark it immediately: the observer will confirm, but a table of
      // contents that lags a click by the length of a smooth scroll feels
      // broken.
      ctx?.registry.setActive(id);
    },
    [ctx],
  );

  return { sections: ctx?.registry.sections ?? [], activeId: ctx?.registry.activeId ?? null, goTo };
}

const noopSubscribe = () => () => {};
const zero = () => 0;

/** `Health check` → `health-check`. Stable across renders and readable in a
 *  URL fragment, so a section can be linked to later without a second scheme. */
export function sectionId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
