import { useSelector } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";

import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import { Spinner } from "@/shared/components/ui/spinner";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { BuilderLogo } from "../builder-logo";
import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { frameworkLabel, monorepoLabel } from "../frameworks";
import { I } from "../icons";
import { BuilderConfig } from "./builder-config";
import { useSourceDefaults } from "./source-defaults";

// ────── Types ──────
interface Builder {
  id: string;
  name: string;
  sub: string;
  popular?: boolean;
  langs?: string[];
}

// ────── Data ──────
const BUILDERS: Builder[] = [
  {
    id: "railpack",
    name: "Railpack",
    sub: "Auto-detect: Node, Python, Go, Rust, Ruby…",
    popular: true,
    langs: ["node", "python", "go", "rust", "ruby", "php", "elixir"],
  },
  {
    id: "dockerfile",
    name: "Dockerfile",
    sub: "Use the Dockerfile in your repo",
  },
  {
    id: "compose",
    name: "Docker Compose",
    sub: "Multi-container from compose.yml",
  },
  {
    id: "buildpack",
    name: "Buildpacks",
    sub: "CNB / Heroku-style cloud-native buildpacks",
  },
  {
    id: "static",
    name: "Static site",
    sub: "Plain HTML / Vite / Astro / Next export",
  },
];

/** "Vite · /Dockerfile": what the inspection found, in one line. */
function detectedLabel(framework: string | null, dockerfilePath: string | null): string {
  return [frameworkLabel(framework), dockerfilePath && `/${dockerfilePath}`]
    .filter(Boolean)
    .join(" · ");
}

/** What the inspection found, and the builder that follows from it. */
function DetectedCard({
  framework,
  monorepo,
  dockerfilePath,
  root,
}: {
  framework: string | null;
  monorepo: string | null;
  dockerfilePath: string | null;
  root: string;
}) {
  return (
    <Card className="mt-3 border-info/40 bg-info/10 p-3.5">
      <div className="flex items-center gap-2">
        <I.check width={14} height={14} className="text-info" />
        <div className="flex-1 text-[13px]">
          <div className="font-medium text-info">
            Detected: {detectedLabel(framework, dockerfilePath)}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            from {root ? `/${root}` : "repo root"} · git.inspectRepo
          </div>
        </div>
        {monorepo && (
          <Badge variant="outline" className="gap-1">
            {monorepoLabel(monorepo)}
          </Badge>
        )}
        <Badge variant="outline" className="gap-1">
          <I.bolt width={9} height={9} />
          {dockerfilePath ? "builds with its Dockerfile" : "railpack recommended"}
        </Badge>
      </div>
    </Card>
  );
}

// ────── DetectionBanner ──────
// Real auto-detect, straight from `git.inspectRepo` for the bound repo + root.
function DetectionBanner() {
  const form = useFormContext();
  const repo = useSelector(form.store, (s) => s.values.repo);
  const root = useSelector(form.store, (s) => s.values.root);

  const inspect = useQuery({
    ...orpc.git.inspectRepo.queryOptions({
      input: repo ? { gitRepoId: repo, path: root || "" } : skipToken,
    }),
    staleTime: 5 * 60 * 1000,
  });

  if (!repo) {
    return (
      <Card className="mt-3 p-3.5 text-[13px] text-muted-foreground">
        Bind a repository on the Source step to auto-detect its framework.
      </Card>
    );
  }

  if (inspect.isLoading) {
    return (
      <Card className="mt-3 flex flex-row items-center gap-2 p-3.5 text-[13px] text-muted-foreground">
        <Spinner className="size-4" />
        Inspecting repo…
      </Card>
    );
  }

  const framework = inspect.data?.framework ?? null;
  const dockerfilePath = inspect.data?.dockerfile?.path ?? null;

  if (!framework && !dockerfilePath) {
    return (
      <Card className="mt-3 p-3.5 text-[13px] text-muted-foreground">
        No framework auto-detected{root ? ` in /${root}` : ""}. Pick a builder below.
      </Card>
    );
  }

  return (
    <DetectedCard
      framework={framework}
      monorepo={inspect.data?.monorepo ?? null}
      dockerfilePath={dockerfilePath}
      root={root}
    />
  );
}

// ────── StepBuilder ──────
export function StepBuilder() {
  const form = useFormContext();
  const builderId = useSelector(form.store, (s) => s.values.builderId);
  // Same handler the Source step's "Build with" toggle uses: stops detection
  // moving the builder, and moves an untouched port to the new build's.
  const defaults = useSourceDefaults(form);

  return (
    <>
      <SectionHeader
        title="How should we build it?"
        sub="Auto-detected from your repo. Change it if you need to."
      />

      <DetectionBanner />

      <div className="mt-3 mb-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {BUILDERS.map((b) => {
          const isActive = builderId === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => void defaults.onBuilderPicked(b.id)}
              className={cn(
                "relative rounded-md border bg-card p-3.5 text-left text-foreground transition-colors hover:border-ring",
                isActive &&
                  "border-foreground bg-accent shadow-[0_0_0_1px_var(--foreground)_inset]",
              )}
            >
              {b.popular && (
                <span className="absolute top-2 right-2 rounded-sm bg-info/12 px-1.5 py-px text-[9px] font-medium tracking-[0.08em] text-info uppercase">
                  popular
                </span>
              )}
              <div className="flex items-center gap-2">
                <BuilderLogo id={b.id} />
                <span className="text-[13px] font-semibold">{b.name}</span>
                {isActive && <I.check width={12} height={12} className="ml-auto text-foreground" />}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{b.sub}</div>
            </button>
          );
        })}
      </div>

      <SectionHeader title="Configuration" />
      <div className="mt-3">
        <BuilderConfig builderId={builderId} />
      </div>
    </>
  );
}
