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
  useMemo,
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

/**
 * A section only counts while its own tab is on screen.
 *
 * Settings and Variables are `keepMounted`, so their cards stay in the DOM
 * after you leave — and kept reporting themselves, which put the Settings
 * sections under whatever tab was open ("Deployments → Identity, Scaling…").
 * A hidden Base UI panel carries `hidden`, so this asks the DOM rather than
 * tracking which tab each card was rendered under.
 */
function isOnScreen(element: HTMLElement): boolean {
  return element.closest("[hidden]") === null;
}

/** The sections of the open tab, the one in view, and how to reach one.
 *
 *  `activeTab` is one signal that the visible set may have changed, but it is
 *  NOT sufficient on its own — see `domVersion` below. */
export function usePanelSections(activeTab: string): {
  sections: PanelSection[];
  activeId: string | null;
  goTo: (id: string) => void;
} {
  const ctx = useContext(SectionsContext);
  const registry = ctx?.registry;
  useSyncExternalStore(registry?.subscribe ?? noopSubscribe, registry?.getSnapshot ?? zero, zero);

  /**
   * Which panels are `hidden` is DOM state this hook does not own, and it
   * settles a frame after the tab value changes — Base UI marks both the
   * outgoing and the incoming panel hidden in one tick (see ui/tabs.tsx).
   * Filtering during the render that follows a tab switch therefore reads the
   * PREVIOUS tab's visibility, and nothing re-runs afterwards, so the rail kept
   * showing the old tab's sections hanging off the new tab: Settings' contents
   * listed under Terminal.
   *
   * So observe the attribute instead of guessing when it lands. This is a
   * subscription to an external system, which is what an effect is for; the
   * filter still runs during render, just with a signal that fires when the
   * DOM it reads actually changes.
   */
  const [domVersion, setDomVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setDomVersion((v) => v + 1);
    });
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  // Recomputed on every registry change AND every tab switch, because a tab
  // switch changes which panels are `hidden` without touching the registry.
  const sections = useMemo(
    () => (ctx?.registry.sections ?? []).filter((section) => isOnScreen(section.element)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version + tab + DOM are the change signals
    [ctx, ctx?.registry.version, activeTab, domVersion],
  );

  // Which section is "here" as you scroll.
  //
  // The trigger line sits below the top of the pane so a heading counts as
  // current while its body still fills the view. That alone can never mark the
  // LAST section — a short Danger zone at the end of the scroll cannot reach a
  // line 12% down the pane — so hitting the bottom marks it explicitly. Without
  // that, the final entry is permanently unreachable, which is exactly what it
  // looked like: clicking it appeared to do nothing.
  useEffect(() => {
    if (!ctx) return;
    const root = ctx.scrollRef.current;

    const markLastIfAtBottom = (): boolean => {
      if (!root) return false;
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 4;
      const last = sections.at(-1);
      if (atBottom && last) {
        ctx.registry.setActive(last.id);
        return true;
      }
      return false;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (markLastIfAtBottom()) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0]?.target;
        if (!(first instanceof HTMLElement)) return;
        const match = sections.find((section) => section.element === first);
        if (match) ctx.registry.setActive(match.id);
      },
      { root, rootMargin: "-12% 0px -70% 0px", threshold: 0 },
    );
    for (const section of sections) observer.observe(section.element);

    // The observer fires on crossings, and the bottom of a scroll is not a
    // crossing — so the last-section case needs its own listener.
    root?.addEventListener("scroll", markLastIfAtBottom, { passive: true });
    return () => {
      observer.disconnect();
      root?.removeEventListener("scroll", markLastIfAtBottom);
    };
    // Re-observe whenever the VISIBLE set changes: a tab switch swaps which
    // panels are hidden, and observing a hidden one would mark it active.
  }, [ctx, sections]);

  const goTo = useCallback(
    (id: string) => {
      const section = sections.find((s) => s.id === id);
      if (!section) return;
      const root = ctx?.scrollRef.current;
      if (root) {
        // Scroll the PANE by offset rather than `scrollIntoView`. Two reasons:
        // scrollIntoView also scrolls every ancestor (it yanked the drawer),
        // and it silently does nothing for the last section, which cannot be
        // brought to the top of a container already scrolled to its end. This
        // always moves as far as it can, which is what a reader expects.
        const top =
          section.element.getBoundingClientRect().top -
          root.getBoundingClientRect().top +
          root.scrollTop;
        root.scrollTo({ top: top - 12, behavior: "smooth" });
      } else {
        section.element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      // Mark it now: the observer will confirm, but a table of contents that
      // lags a click by the length of a smooth scroll feels broken — and for
      // the last section the observer may never fire at all.
      ctx?.registry.setActive(id);
    },
    [ctx, sections],
  );

  // The marked section must be one of the VISIBLE ones: a stale id from the
  // tab you just left would light nothing, or worse, the wrong row.
  const activeId = sections.some((s) => s.id === ctx?.registry.activeId)
    ? (ctx?.registry.activeId ?? null)
    : (sections[0]?.id ?? null);

  return { sections, activeId, goTo };
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
