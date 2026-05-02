import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Pencil } from "lucide-react";
import * as z from "zod";

import {
  Tooltip,
  TooltipTrigger,
  TooltipPopup,
} from "@/components/ui/tooltip";

const searchParams = z.object({
  env: z.string().default("development"),
});

export const Route = createFileRoute("/_dashboard/playground")({
  validateSearch: searchParams,
  component: PlaygroundRoute,
});

type EnvColor = "blue" | "amber" | "emerald" | "rose" | "violet" | "cyan";

type Environment = {
  id: string;
  name: string;
  label: string;
  color: EnvColor;
  description: string;
  services: number;
  databases: number;
};

const defaultEnvironments: Environment[] = [
  { id: "env-dev", name: "development", label: "Dev", color: "blue", description: "Local testing & iteration", services: 3, databases: 1 },
  { id: "env-staging", name: "staging", label: "Staging", color: "amber", description: "Pre-production validation", services: 3, databases: 1 },
  { id: "env-prod", name: "production", label: "Prod", color: "emerald", description: "Live traffic & users", services: 5, databases: 2 },
];

const colorOptions: EnvColor[] = ["blue", "amber", "emerald", "rose", "violet", "cyan"];

const dotColors: Record<EnvColor, { active: string; inactive: string }> = {
  blue: { active: "bg-blue-400", inactive: "bg-blue-400/30" },
  amber: { active: "bg-amber-400", inactive: "bg-amber-400/30" },
  emerald: { active: "bg-emerald-400", inactive: "bg-emerald-400/30" },
  rose: { active: "bg-rose-400", inactive: "bg-rose-400/30" },
  violet: { active: "bg-violet-400", inactive: "bg-violet-400/30" },
  cyan: { active: "bg-cyan-400", inactive: "bg-cyan-400/30" },
};

const panelStyles: Record<EnvColor, string> = {
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  rose: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-400",
  cyan: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
};

const expandedItemStyles: Record<EnvColor, string> = {
  blue: "border-blue-500/20 hover:border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10",
  amber: "border-amber-500/20 hover:border-amber-500/40 bg-amber-500/5 hover:bg-amber-500/10",
  emerald: "border-emerald-500/20 hover:border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10",
  rose: "border-rose-500/20 hover:border-rose-500/40 bg-rose-500/5 hover:bg-rose-500/10",
  violet: "border-violet-500/20 hover:border-violet-500/40 bg-violet-500/5 hover:bg-violet-500/10",
  cyan: "border-cyan-500/20 hover:border-cyan-500/40 bg-cyan-500/5 hover:bg-cyan-500/10",
};

const expandedActiveStyles: Record<EnvColor, string> = {
  blue: "border-blue-500/50 bg-blue-500/15 ring-1 ring-blue-500/20",
  amber: "border-amber-500/50 bg-amber-500/15 ring-1 ring-amber-500/20",
  emerald: "border-emerald-500/50 bg-emerald-500/15 ring-1 ring-emerald-500/20",
  rose: "border-rose-500/50 bg-rose-500/15 ring-1 ring-rose-500/20",
  violet: "border-violet-500/50 bg-violet-500/15 ring-1 ring-violet-500/20",
  cyan: "border-cyan-500/50 bg-cyan-500/15 ring-1 ring-cyan-500/20",
};

function PlaygroundRoute() {
  const { env } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [environments, setEnvironments] = useState<Environment[]>(defaultEnvironments);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const currentIndex = Math.max(
    0,
    environments.findIndex((e) => e.name === env),
  );

  function startRename(e: Environment) {
    setEditingId(e.id);
    setEditValue(e.label);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitRename(envId: string) {
    if (!editValue.trim()) {
      setEditingId(null);
      return;
    }

    const oldEnv = environments.find((e) => e.id === envId);
    setEnvironments((prev) =>
      prev.map((e) =>
        e.id === envId ? { ...e, label: editValue.trim() } : e,
      ),
    );

    // If renaming the active env, update the search param
    if (oldEnv && oldEnv.name === env) {
      // name stays the same, only label changes — no nav needed
    }

    setEditingId(null);
  }

  function setEnvColor(envId: string, color: EnvColor) {
    setEnvironments((prev) =>
      prev.map((e) => (e.id === envId ? { ...e, color } : e)),
    );
  }

  return (
    <div className="flex h-screen flex-col gap-4 overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <code className="rounded bg-muted px-2 py-1 text-foreground">
            {environments[currentIndex]?.label}
          </code>
        </p>

        <div className="relative">
          <div
            className="flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-2"
            onDoubleClick={() => setExpanded(!expanded)}
          >
            {environments.map((e) => (
              <Tooltip key={e.id}>
                <TooltipTrigger
                  render={
                    <button
                      className={`size-3 rounded-full transition-all ${
                        env === e.name
                          ? `${dotColors[e.color].active} scale-125`
                          : `${dotColors[e.color].inactive} hover:scale-110`
                      }`}
                      onClick={() => navigate({ search: { env: e.name } })}
                      type="button"
                    />
                  }
                />
                <TooltipPopup side="bottom" sideOffset={12}>
                  <div className="space-y-1 p-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`size-1.5 rounded-full ${dotColors[e.color].active}`} />
                      <span className="font-medium">{e.label}</span>
                    </div>
                    <div className="text-muted-foreground">{e.description}</div>
                    <div className="flex gap-2 pt-0.5 text-muted-foreground/60">
                      <span>{e.services} services</span>
                      <span>{e.databases} db</span>
                    </div>
                  </div>
                </TooltipPopup>
              </Tooltip>
            ))}
          </div>

          {/* Expanded tray */}
          <div
            className={`absolute right-0 top-full z-50 mt-2 origin-top-right transition-all duration-200 ${
              expanded
                ? "scale-100 opacity-100"
                : "pointer-events-none scale-95 opacity-0"
            }`}
          >
            <div className="w-72 rounded-xl border border-border bg-background/95 p-2 shadow-xl backdrop-blur-md">
              <div className="mb-2 px-2 pt-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground/60">
                Environments
              </div>
              <div className="space-y-1">
                {environments.map((e) => (
                  <div
                    key={e.id}
                    className={`rounded-lg border p-3 transition-all ${
                      env === e.name
                        ? expandedActiveStyles[e.color]
                        : expandedItemStyles[e.color]
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`size-2 shrink-0 rounded-full ${dotColors[e.color].active}`}
                      />
                      <div className="min-w-0 flex-1">
                        {editingId === e.id ? (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(ev) => {
                              ev.preventDefault();
                              commitRename(e.id);
                            }}
                          >
                            <input
                              ref={inputRef}
                              className="h-5 w-full min-w-0 rounded border border-border bg-background px-1.5 text-sm font-medium text-foreground outline-none focus:ring-1 focus:ring-ring"
                              onChange={(ev) => setEditValue(ev.target.value)}
                              onBlur={() => commitRename(e.id)}
                              onKeyDown={(ev) => {
                                if (ev.key === "Escape") setEditingId(null);
                              }}
                              value={editValue}
                            />
                            <button
                              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
                              type="submit"
                            >
                              <Check className="size-3" />
                            </button>
                          </form>
                        ) : (
                          <div className="flex items-center justify-between">
                            <button
                              className="text-sm font-medium text-foreground"
                              onClick={() => {
                                navigate({ search: { env: e.name } });
                                setExpanded(false);
                              }}
                              type="button"
                            >
                              {e.label}
                            </button>
                            <div className="flex items-center gap-1.5">
                              {env === e.name && (
                                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                  Active
                                </span>
                              )}
                              <button
                                className="rounded p-0.5 text-muted-foreground/40 hover:text-muted-foreground"
                                onClick={() => startRename(e)}
                                type="button"
                              >
                                <Pencil className="size-3" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {editingId !== e.id && (
                      <div className="mt-1 pl-5 text-xs text-muted-foreground">
                        {e.description}
                      </div>
                    )}

                    {/* Color picker */}
                    <div className="mt-2 flex items-center gap-1.5 pl-5">
                      {colorOptions.map((c) => (
                        <button
                          key={c}
                          className={`size-3.5 rounded-full transition-all ${dotColors[c].active} ${
                            e.color === c
                              ? "ring-2 ring-white/30 ring-offset-1 ring-offset-background"
                              : "opacity-40 hover:opacity-70"
                          }`}
                          onClick={() => setEnvColor(e.id, c)}
                          type="button"
                        />
                      ))}
                    </div>

                    <div className="mt-2 flex gap-3 pl-5 text-[10px] text-muted-foreground/60">
                      <span>{e.services} services</span>
                      <span>{e.databases} databases</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {expanded && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => setExpanded(false)}
            />
          )}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-2xl">
        <div
          className="flex h-full transition-transform duration-500 ease-in-out"
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {environments.map((e) => (
            <div
              key={e.id}
              className={`flex h-full w-full shrink-0 items-center justify-center rounded-2xl border ${panelStyles[e.color]}`}
            >
              <span className="text-4xl font-bold opacity-60">{e.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
