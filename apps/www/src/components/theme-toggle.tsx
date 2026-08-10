import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/**
 * The one theme toggle, shared by the landing header and the docs site bar.
 *
 * Dependency-free on purpose: Fumadocs' RootProvider (next-themes,
 * attribute=class, storageKey="theme") applies the stored theme on load by
 * toggling `.dark` on <html>. This flips the same class and writes the same
 * key, so the landing page and the docs never disagree about the theme.
 *
 * Fumadocs would render its own switch at the foot of the docs sidebar; that's
 * disabled where the layout is mounted, so there is exactly one on any page.
 */
export function ThemeToggle() {
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Private mode or storage disabled: the toggle still works for this
      // page load, it just won't be remembered.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:translate-y-px"
    >
      {/* Which icon shows is decided by the `dark` class, not by React state.
          Reading the theme into state would mean rendering the wrong icon
          until the first effect ran. A visible flip on every page load. */}
      <HugeiconsIcon icon={Moon02Icon} className="size-4 dark:hidden" />
      <HugeiconsIcon icon={Sun03Icon} className="hidden size-4 dark:block" />
    </button>
  );
}
