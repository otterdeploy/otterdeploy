import { useStore } from "@tanstack/react-form";
import { skipToken, useQuery } from "@tanstack/react-query";

import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Spinner } from "@/shared/components/ui/spinner";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";
import { orpc } from "@/shared/server/orpc";

import { BuilderLogo } from "../builder-logo";
import { useFormContext } from "../form-context";
import { Field, SectionHeader } from "../form-primitives";
import { frameworkLabel, monorepoLabel } from "../frameworks";
import { I } from "../icons";

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
    sub: "Auto-detect — Node, Python, Go, Rust, Ruby…",
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

// ────── BuilderConfigHeader ──────
function ConfigHeader({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      {icon}
      <span className="text-[13px] font-semibold">{title}</span>
      {children}
    </div>
  );
}

// ────── BuilderConfig ──────
// All inputs are blank with placeholders — these are the operator's choices,
// not claims about their repo. Auto-detection lives in the banner above,
// driven by the real `git.inspectRepo` result.
function BuilderConfig({ builderId }: { builderId: string }) {
  if (builderId === "railpack") {
    return (
      <Card className="p-4.5">
        <ConfigHeader
          icon={<I.bolt width={14} height={14} className="text-muted-foreground" />}
          title="Railpack auto-detect"
        />
        <p className="mb-3.5 text-xs text-muted-foreground">
          Railpack inspects your repo and assembles an OCI image automatically. Override individual
          layers below if needed.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Install command (override)">
            <Input className="font-mono" placeholder="auto" />
          </Field>
          <Field label="Build command (override)">
            <Input className="font-mono" placeholder="auto" />
          </Field>
        </div>
        <div className="mt-2.5">
          <Field label="Root directory">
            <Input className="font-mono" placeholder="e.g. apps/web · empty = repo root" />
          </Field>
        </div>
      </Card>
    );
  }

  if (builderId === "dockerfile") {
    return (
      <Card className="p-4.5">
        <ConfigHeader
          icon={<I.doc width={14} height={14} className="text-muted-foreground" />}
          title="Dockerfile"
        />
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Dockerfile path">
            <Input className="font-mono" placeholder="Dockerfile" />
          </Field>
          <Field label="Build context">
            <Input className="font-mono" placeholder="." />
          </Field>
        </div>
        <div className="mt-2.5">
          <Field label="Target stage (multi-stage)">
            <Input className="font-mono" placeholder="optional · e.g. runtime" />
          </Field>
        </div>
        <div className="mt-2.5">
          <Field label="Build args (one per line, KEY=value)">
            <Textarea
              className="font-mono"
              rows={3}
              placeholder={"NODE_VERSION=24\nGIT_SHA=$COMMIT_SHA"}
            />
          </Field>
        </div>
      </Card>
    );
  }

  if (builderId === "compose") {
    return (
      <Card className="p-4.5">
        <ConfigHeader
          icon={<I.service width={14} height={14} className="text-muted-foreground" />}
          title="Docker Compose"
        >
          <Badge variant="outline" className="gap-1">
            <I.warning width={9} height={9} />
            deploys all services in compose.yml as a Docker Stack
          </Badge>
        </ConfigHeader>
        <Field label="Compose file">
          <Input className="font-mono" placeholder="compose.yml" />
        </Field>
        <div className="mt-2.5">
          <Field label="Profiles (comma separated)">
            <Input className="font-mono" placeholder="prod, observability" />
          </Field>
        </div>
      </Card>
    );
  }

  if (builderId === "buildpack") {
    return (
      <Card className="p-4.5">
        <ConfigHeader icon={<I.folder width={14} height={14} />} title="Cloud-Native Buildpacks" />
        <Field label="Builder image">
          <Select
            defaultValue="paketo"
            items={[
              {
                label: "paketobuildpacks/builder-jammy-base:latest",
                value: "paketo",
              },
              { label: "heroku/builder:24", value: "heroku" },
              { label: "gcr.io/buildpacks/builder:v1", value: "gcp" },
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paketo">paketobuildpacks/builder-jammy-base:latest</SelectItem>
              <SelectItem value="heroku">heroku/builder:24</SelectItem>
              <SelectItem value="gcp">gcr.io/buildpacks/builder:v1</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="mt-2.5">
          <Field label="Buildpacks (in order, one per line)">
            <Textarea
              className="font-mono"
              rows={3}
              placeholder={"auto — leave blank to let the builder choose"}
            />
          </Field>
        </div>
      </Card>
    );
  }

  // static (default)
  return (
    <Card className="p-4.5">
      <ConfigHeader icon={<I.globe width={14} height={14} />} title="Static site" />
      <Field label="Build command">
        <Input className="font-mono" placeholder="e.g. pnpm build" />
      </Field>
      <div className="mt-2.5">
        <Field label="Output directory">
          <Input className="font-mono" placeholder="e.g. dist" />
        </Field>
      </div>
    </Card>
  );
}

// ────── DetectionBanner ──────
// Real auto-detect, straight from `git.inspectRepo` for the bound repo + root.
function DetectionBanner() {
  const form = useFormContext();
  const repo = useStore(form.store, (s) => s.values.repo as string);
  const root = useStore(form.store, (s) => s.values.root as string);

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
  const monorepo = inspect.data?.monorepo ?? null;

  if (!framework) {
    return (
      <Card className="mt-3 p-3.5 text-[13px] text-muted-foreground">
        No framework auto-detected{root ? ` in /${root}` : ""}. Pick a builder below.
      </Card>
    );
  }

  return (
    <Card className="mt-3 border-info/40 bg-info/10 p-3.5">
      <div className="flex items-center gap-2">
        <I.check width={14} height={14} className="text-info" />
        <div className="flex-1 text-[13px]">
          <div className="font-medium text-info">Detected: {frameworkLabel(framework)}</div>
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
          railpack recommended
        </Badge>
      </div>
    </Card>
  );
}

// ────── StepBuilder ──────
export function StepBuilder() {
  const form = useFormContext();
  const builderId = useStore(form.store, (s) => s.values.builderId as string);

  return (
    <>
      <SectionHeader
        title="How should we build it?"
        sub="Auto-detected from your repo — change it if you need to"
      />

      <DetectionBanner />

      <div className="mt-3 mb-4 grid grid-cols-2 gap-2.5">
        {BUILDERS.map((b) => {
          const isActive = builderId === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => form.setFieldValue("builderId", b.id)}
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
