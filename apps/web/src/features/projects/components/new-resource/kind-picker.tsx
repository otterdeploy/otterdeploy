// KindPicker: source-first launcher for the create-resource wizard's first
// step. Top level is six *source/category* cards (git, image, database,
// compose, template, empty); "Create database" drills into an engine
// sub-picker, "From template" into an in-dialog template search. The workload
// role (web app vs static vs worker) is NOT a card. It's a downstream field,
// because the same role can be built from any source.
// Extracted from StepKind so it can be reused in dialogs.
import { useHotkey } from "@tanstack/react-hotkeys";

import {
  LAUNCH_CATEGORIES,
  SERVICE_KINDS,
  type LaunchCategory,
  type ServiceKind,
} from "@/features/projects/data/service-kinds";
import { DatabaseLogo } from "@/shared/components/brand/database-logo";
import { Kbd } from "@/shared/components/ui/kbd";
import { Docker } from "@/shared/components/ui/svgs/docker";
import { Github } from "@/shared/components/ui/svgs/github";
import { cn } from "@/shared/lib/utils";

import {
  builderCardActiveClass,
  builderCardClass,
  builderIconClass,
  builderPopClass,
} from "./form-primitives";
import { I } from "./icons";
import { TemplatePicker } from "./template-picker";

// Engines offered under "Create database", the data-group kinds, wired ones
// first, coming-soon ones gated.
const DB_ENGINES = SERVICE_KINDS.filter((k) => k.group === "database");
const DB_ENGINE_IDS = new Set(DB_ENGINES.map((k) => k.id));

const SOON_CHIP = cn(builderPopClass, "bg-muted text-muted-foreground");

// ── Category icon, sized for the 26px card tile ────────────────────────────
function CategoryIcon({ id }: { id: LaunchCategory["id"] }) {
  const klass = "size-[15px]";
  switch (id) {
    case "git":
      return <Github className={klass} />;
    case "image":
    case "compose":
      return <Docker className={klass} />;
    case "database":
      return <I.db className={cn(klass, "text-foreground")} />;
    case "template":
      return <I.graph className={cn(klass, "text-foreground")} />;
    case "empty":
      return <I.plus className={cn(klass, "text-foreground")} />;
  }
}

interface KindPickerProps {
  value: string | null;
  /** Selects a terminal kindId (e.g. "app", "docker", "postgres"). */
  onChange: (id: string) => void;
  /** Engine sub-view toggle, owned by the wizard so its "Back" can live in
   *  the footer next to Continue. */
  dbView: boolean;
  onDbViewChange: (open: boolean) => void;
  /** Template sub-view toggle, wizard-owned for the same footer reason. */
  templateView: boolean;
  onTemplateViewChange: (open: boolean) => void;
}

export function KindPicker({
  value,
  onChange,
  dbView,
  onDbViewChange,
  templateView,
  onTemplateViewChange,
}: KindPickerProps) {
  // "D" opens this wizard; "T" on the cards drills into template search, so
  // D→T is the whole "deploy a template" gesture. Only live while the cards
  // are showing (the sub-views have real text inputs).
  useHotkey("T", () => onTemplateViewChange(true), { enabled: !dbView && !templateView });

  if (templateView) {
    return <TemplatePicker />;
  }

  if (dbView) {
    return (
      <>
        <div className="mb-3 text-sm font-semibold">Pick a database engine</div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {DB_ENGINES.map((engine) => (
            <EngineCard
              key={engine.id}
              engine={engine}
              active={value === engine.id}
              onSelect={() => onChange(engine.id)}
            />
          ))}
        </div>
      </>
    );
  }

  // Which category card reads as selected, derived from the chosen kindId.
  const activeCat: LaunchCategory["id"] | null =
    value === "docker"
      ? "image"
      : value === "compose"
        ? "compose"
        : value && DB_ENGINE_IDS.has(value)
          ? "database"
          : value
            ? "git"
            : null;

  const onCardClick = (cat: LaunchCategory) => {
    if (cat.comingSoon) return;
    if (cat.id === "database") {
      onDbViewChange(true);
      return;
    }
    if (cat.id === "template") {
      // In-dialog template search (no detour through the gallery page).
      // Picking one hands off via ?new=template, same as the gallery does.
      onTemplateViewChange(true);
      return;
    }
    if (cat.kindId) onChange(cat.kindId);
  };

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {LAUNCH_CATEGORIES.map((cat) => {
        const active = activeCat === cat.id;
        const soon = cat.comingSoon === true;
        return (
          <button
            key={cat.id}
            type="button"
            disabled={soon}
            aria-disabled={soon}
            onClick={() => onCardClick(cat)}
            className={cn(
              builderCardClass,
              "min-h-24",
              active && builderCardActiveClass,
              soon && "cursor-not-allowed opacity-55 hover:border-border",
            )}
          >
            {soon && <span className={SOON_CHIP}>soon</span>}
            {cat.id === "template" && (
              <Kbd className="absolute top-2 right-2 h-4 min-w-4 px-1 text-[10px] text-muted-foreground">
                T
              </Kbd>
            )}
            <div className="flex items-center gap-2">
              <div className={builderIconClass}>
                <CategoryIcon id={cat.id} />
              </div>
              <div className="flex-1 text-[13px] font-semibold">{cat.name}</div>
            </div>
            <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{cat.sub}</div>
          </button>
        );
      })}
    </div>
  );
}

function EngineCard({
  engine,
  active,
  onSelect,
}: {
  engine: ServiceKind;
  active: boolean;
  onSelect: () => void;
}) {
  const soon = engine.comingSoon === true;
  return (
    <button
      type="button"
      disabled={soon}
      aria-disabled={soon}
      onClick={() => !soon && onSelect()}
      className={cn(
        builderCardClass,
        "min-h-24",
        active && builderCardActiveClass,
        soon && "cursor-not-allowed opacity-55 hover:border-border",
      )}
    >
      {soon ? (
        <span className={SOON_CHIP}>soon</span>
      ) : (
        active && (
          <I.check width={12} height={12} className="absolute top-2.5 right-2.5 text-foreground" />
        )
      )}
      <div className="flex items-center gap-2">
        <div className={builderIconClass}>
          <DatabaseLogo
            value={`${engine.id} ${engine.name}`}
            size={14}
            color="var(--muted-foreground)"
          />
        </div>
        <div className="flex-1 text-[13px] font-semibold">{engine.name}</div>
      </div>
      <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{engine.sub}</div>
      {engine.versions && (
        <div className="mt-1.5 font-mono text-[10px] text-muted-foreground">
          versions: {engine.versions.slice(0, 3).join(", ")}
        </div>
      )}
    </button>
  );
}
