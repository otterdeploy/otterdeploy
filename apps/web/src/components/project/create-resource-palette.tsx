import { useState } from "react";
import { useQuery } from "@rocicorp/zero/react";
import { queries } from "@otterdeploy/zero/queries";
import { mutators } from "@otterdeploy/zero/mutators";
import { useParams, useRouter } from "@tanstack/react-router";
import { useHotkey } from "@tanstack/react-hotkeys";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { ApiIcon, CpuIcon, DatabaseIcon, GlobeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { createId } from "@otterdeploy/utils";

export const kindOptions = [
  { value: "web", label: "Web", icon: GlobeIcon },
  { value: "api", label: "API", icon: ApiIcon },
  { value: "worker", label: "Worker", icon: CpuIcon },
  { value: "database", label: "Database", icon: DatabaseIcon },
] as const;

export type ResourceKind = (typeof kindOptions)[number]["value"];

const databaseEngines = [
  { value: "postgresql", label: "PostgreSQL", description: "Reliable relational database" },
  { value: "mysql", label: "MySQL", description: "Popular open-source RDBMS" },
  { value: "mariadb", label: "MariaDB", description: "Community-driven MySQL fork" },
  { value: "mongodb", label: "MongoDB", description: "Document-oriented NoSQL" },
  { value: "redis", label: "Redis", description: "In-memory data store" },
  { value: "keydb", label: "KeyDB", description: "High-performance Redis fork" },
  { value: "dragonfly", label: "Dragonfly", description: "Modern Redis-compatible store" },
  { value: "clickhouse", label: "ClickHouse", description: "Column-oriented analytics DB" },
] as const;

type DatabaseEngine = (typeof databaseEngines)[number]["value"];
export type { DatabaseEngine };
type PaletteStep = "pick-type" | "pick-database";

export function CreateResourcePalette({
  environmentId,
  onCreated,
}: {
  onCreated: (resource: {
    id: string;
    name: string;
    kind: ResourceKind;
    status: string;
    databaseEngine?: DatabaseEngine;
  }) => void;
  environmentId: string;
}) {
  const { projectId } = useParams({ from: "/dash/projects/$projectId" });
  const { zero } = useRouter().options.context;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<PaletteStep>("pick-type");

  useHotkey("C", (e) => {
    e.preventDefault();
    setOpen((prev) => !prev);
  });

  const [project] = useQuery(queries.project.byId({ projectId }));
  const [resources] = useQuery(environmentId ? queries.resource.list({ environmentId }) : undefined);

  const NODE_WIDTH = 180;
  const GAP = 40;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setStep("pick-type");
  }

  async function createResource(kind: ResourceKind, name: string, databaseEngine?: DatabaseEngine) {
    if (!zero || !project?.organizationId || !environmentId) return;

    const id = createId();

    let posX = 100;
    let posY = 100;
    if (resources && resources.length > 0) {
      let rightmost = resources[0];
      for (const r of resources) {
        if ((r.position?.posX ?? 0) > (rightmost.position?.posX ?? 0)) {
          rightmost = r;
        }
      }
      posX = (rightmost.position?.posX ?? 0) + NODE_WIDTH + GAP;
      posY = rightmost.position?.posY ?? 100;
    }
    zero.mutate(
      mutators.resource.create({
        id,
        organizationId: project.organizationId,
        projectId,
        environmentId,
        kind,
        name,
        posX,
        posY,
        now: Date.now(),
        ...(databaseEngine && {
          databaseConfigId: createId(),
          databaseEngine,
        }),
      }),
    );

    onCreated({ id, name, kind, status: "unknown", databaseEngine });

    handleOpenChange(false);
  }

  function handleSelectKind(kind: ResourceKind) {
    if (kind === "database") {
      setStep("pick-database");
      return;
    }
    const label = kindOptions.find((o) => o.value === kind)?.label ?? kind;
    createResource(kind, label);
  }

  function handleSelectDatabase(engine: DatabaseEngine) {
    const label = databaseEngines.find((e) => e.value === engine)?.label ?? engine;
    createResource("database", label, engine);
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        Create
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title={step === "pick-type" ? "Create resource" : "New Database"}
        description={
          step === "pick-type"
            ? "Pick a resource type to add to your project."
            : "Choose a database engine."
        }
      >
        <Command>
          <CommandInput
            placeholder={
              step === "pick-type" ? "What would you like to create?" : "Search databases..."
            }
          />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>

            {step === "pick-type" && (
              <CommandGroup>
                {kindOptions.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.label}
                    onSelect={() => handleSelectKind(opt.value)}
                    className="py-2.5 px-3 cursor-pointer"
                  >
                    <HugeiconsIcon icon={opt.icon} className="size-5 text-muted-foreground" />
                    <span className="flex-1">{opt.label}</span>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {step === "pick-database" && (
              <CommandGroup>
                {databaseEngines.map((db) => (
                  <CommandItem
                    key={db.value}
                    value={db.label}
                    onSelect={() => handleSelectDatabase(db.value)}
                    className="py-2.5 px-3 cursor-pointer"
                  >
                    <HugeiconsIcon icon={DatabaseIcon} className="size-5 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <span className="block text-sm">{db.label}</span>
                      <span className="block text-xs text-muted-foreground">{db.description}</span>
                    </div>
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
