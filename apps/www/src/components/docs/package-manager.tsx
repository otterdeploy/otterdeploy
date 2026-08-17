import { useCallback, useEffect, useRef, useState } from "react";

import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/**
 * Install command with a package-manager switcher.
 *
 * Four managers, one command, and the choice is remembered. A reader who
 * picked pnpm on the install page shouldn't have to pick it again on the CLI
 * page. Labels are text, not logos: the four marks are different shapes at
 * different optical weights, and lining them up in a 20px row looks like a
 * sticker sheet. The words are also what you type.
 *
 * The tab row is a real radiogroup, so arrow keys work and a screen reader
 * announces "npm, selected, 2 of 4" instead of four unlabelled buttons.
 */

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
type Manager = (typeof MANAGERS)[number];

const STORAGE_KEY = "otterdeploy-docs-pm";

function isManager(value: string): value is Manager {
  return MANAGERS.some((m) => m === value);
}

/** Real install syntax per manager: these differ more than people remember. */
function command(pm: Manager, pkg: string, global: boolean, dev: boolean): string {
  if (global) {
    if (pm === "npm") return `npm install -g ${pkg}`;
    if (pm === "yarn") return `yarn global add ${pkg}`;
    return `${pm} add -g ${pkg}`;
  }
  const flag = dev ? (pm === "npm" ? " --save-dev" : " -D") : "";
  if (pm === "npm") return `npm install${flag} ${pkg}`;
  return `${pm} add${flag} ${pkg}`;
}

export function PackageManager({
  pkg,
  global: isGlobal = false,
  dev = false,
}: {
  pkg: string;
  global?: boolean;
  dev?: boolean;
}) {
  // `npm` on the server and on first paint, so SSR and hydration agree; the
  // stored preference is applied after mount.
  const [pm, setPm] = useState<Manager>("npm");
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && isManager(saved)) setPm(saved);
      } catch {
        // Storage disabled: the default is fine.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const choose = useCallback((next: Manager) => {
    setPm(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage disabled: the choice still applies to this page.
    }
  }, []);

  const cmd = command(pm, pkg, isGlobal, dev);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (http origin, locked-down browser): the text is
      // selectable, so say nothing rather than claim a copy that didn't happen.
    }
  }, [cmd]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = MANAGERS[(MANAGERS.indexOf(pm) + dir + MANAGERS.length) % MANAGERS.length];
    choose(next);
  };

  return (
    <div className="my-5 overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <div role="radiogroup" aria-label="Package manager" className="flex items-center gap-0.5">
          {MANAGERS.map((m) => {
            const on = m === pm;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => choose(m)}
                onKeyDown={onKeyDown}
                className={
                  "rounded-md px-2.5 py-1 font-mono text-[0.75rem] transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 " +
                  (on
                    ? "bg-foreground/8 text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {m}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={copy}
          aria-label={`Copy: ${cmd}`}
          className="ml-auto grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors duration-200 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <HugeiconsIcon
            icon={copied ? Tick02Icon : Copy01Icon}
            className={copied ? "size-4 text-success" : "size-4"}
          />
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? "Copied to clipboard" : ""}
        </span>
      </div>

      {/* `bg-transparent p-0 border-0` on the <code>: the docs prose styles
          give inline code a chip background, and inheriting it here draws a
          box inside the panel's own box, a card in a card. */}
      <pre className="od-noscroll overflow-x-auto bg-transparent px-4 py-3">
        <code className="border-0 bg-transparent p-0 font-mono text-[0.8125rem] whitespace-nowrap text-foreground">
          {cmd}
        </code>
      </pre>
    </div>
  );
}
