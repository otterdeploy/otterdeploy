import type { Rocket01Icon } from "@hugeicons/core-free-icons";
import type { LinkProps } from "@tanstack/react-router";

export type RoutePath = LinkProps["to"];
export type Status = "ok" | "warn" | "err";

export interface NavItem {
  /** i18n key resolved at render time, e.g. "nav.overview". */
  titleKey: string;
  href: RoutePath;
  icon: typeof Rocket01Icon;
  badge?: string;
  active?: boolean;
}

const STATUS_DOT: Record<Status, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  err: "bg-rose-500",
};

export function StatusDot({ status, className = "" }: { status: Status; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2 shrink-0 rounded-full ${STATUS_DOT[status]} ${className}`}
    />
  );
}
