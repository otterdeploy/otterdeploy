import { useStore } from "@tanstack/react-form";

import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/lib/utils";

import { Field, SectionHeader } from "../form-primitives";
import { useFormContext } from "../form-context";
import { I, type IconKey } from "../icons";

// ────── Types ──────
interface Builder {
  id: string;
  name: string;
  sub: string;
  icon: string;
  popular?: boolean;
  langs?: string[];
}

// ────── Data ──────
const BUILDERS: Builder[] = [
  {
    id: "railpack",
    name: "Railpack",
    sub: "Auto-detect — Node, Python, Go, Rust, Ruby…",
    icon: "bolt",
    popular: true,
    langs: ["node", "python", "go", "rust", "ruby", "php", "elixir"],
  },
  {
    id: "dockerfile",
    name: "Dockerfile",
    sub: "Use the Dockerfile in your repo",
    icon: "doc",
  },
  {
    id: "compose",
    name: "Docker Compose",
    sub: "Multi-container from compose.yml",
    icon: "service",
  },
  {
    id: "buildpack",
    name: "Buildpacks",
    sub: "CNB / Heroku-style cloud-native buildpacks",
    icon: "folder",
  },
  {
    id: "nixpack",
    name: "Nixpacks",
    sub: "Reproducible Nix-derived images",
    icon: "graph",
  },
  {
    id: "static",
    name: "Static site",
    sub: "Plain HTML / Vite / Astro / Next export",
    icon: "globe",
  },
];

const detected = {
  lang: "Node 20",
  file: "package.json",
  framework: "Next.js 15",
  detector: "railpack",
};

const iconKey = (raw: string): IconKey =>
  (raw as IconKey) in I ? (raw as IconKey) : "doc";

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
function BuilderConfig({ builderId, service }: { builderId: string; service: string }) {
  if (builderId === "railpack") {
    return (
      <Card className="p-4.5">
        <ConfigHeader
          icon={<I.bolt width={14} height={14} className="text-muted-foreground" />}
          title="Railpack auto-detect"
        >
          <Badge variant="outline" className="gap-1 border-success/40 bg-success/10 text-success">
            <span className="size-1.5 rounded-full bg-success" />
            Node 20 detected
          </Badge>
        </ConfigHeader>
        <p className="mb-3.5 text-xs text-muted-foreground">
          Railpack inspects your repo and assembles an OCI image automatically. Override individual
          layers below if needed.
        </p>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Install command (override)">
            <Input className="font-mono" placeholder="auto: pnpm install --frozen-lockfile" />
          </Field>
          <Field label="Build command (override)">
            <Input
              className="font-mono"
              placeholder={service === "web" ? "auto: pnpm build" : "auto: tsc -p ."}
            />
          </Field>
        </div>
        <div className="mt-2.5">
          <Field label="Root directory">
            <Input className="font-mono" defaultValue={`apps/${service}`} />
          </Field>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">Detected layers</div>
        <Card className="mt-1.5 gap-0 bg-muted p-2.5">
          <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            <div>
              1. <span className="text-info">setup</span>
              {"     "}· alpine + corepack
            </div>
            <div>
              2. <span className="text-info">install</span>
              {"   "}· pnpm install --frozen-lockfile
            </div>
            <div>
              3. <span className="text-info">build</span>
              {"     "}· pnpm --filter ./apps/{service} build
            </div>
            <div>
              4. <span className="text-info">runtime</span>
              {"   "}· gcr.io/distroless/nodejs20-debian12
            </div>
          </div>
        </Card>
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
            <Input className="font-mono" defaultValue={`apps/${service}/Dockerfile`} />
          </Field>
          <Field label="Build context">
            <Input className="font-mono" defaultValue="." />
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
              defaultValue={`NODE_VERSION=20\nGIT_SHA=$COMMIT_SHA`}
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
          <Input className="font-mono" defaultValue="compose.yml" />
        </Field>
        <div className="mt-2.5">
          <Field label="Profiles (comma separated)">
            <Input className="font-mono" placeholder="prod, observability" />
          </Field>
        </div>
        <div className="mt-3 text-[11px] text-muted-foreground">Detected services</div>
        <Card className="mt-1.5 bg-muted p-2.5">
          <div className="font-mono text-[11px] leading-relaxed">
            web (build: ./apps/web) · api (build: ./apps/api) · worker (build: ./apps/worker) ·
            postgres:16 · redis:7
          </div>
        </Card>
      </Card>
    );
  }

  if (builderId === "buildpack") {
    return (
      <Card className="p-4.5">
        <ConfigHeader
          icon={<I.folder width={14} height={14} />}
          title="Cloud-Native Buildpacks"
        />
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
              <SelectItem value="paketo">
                paketobuildpacks/builder-jammy-base:latest
              </SelectItem>
              <SelectItem value="heroku">heroku/builder:24</SelectItem>
              <SelectItem value="gcp">gcr.io/buildpacks/builder:v1</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="mt-2.5">
          <Field label="Buildpacks (in order)">
            <Textarea
              className="font-mono"
              rows={3}
              defaultValue={`paketo-buildpacks/nodejs\npaketo-buildpacks/npm-install\npaketo-buildpacks/npm-start`}
            />
          </Field>
        </div>
      </Card>
    );
  }

  if (builderId === "nixpack") {
    return (
      <Card className="p-4.5">
        <ConfigHeader icon={<I.graph width={14} height={14} />} title="Nixpacks" />
        <Field label="Nixpacks providers (comma separated)">
          <Input className="font-mono" defaultValue="node, pnpm" />
        </Field>
        <div className="mt-2.5">
          <Field label="Custom nixpacks.toml">
            <Textarea
              className="font-mono"
              rows={5}
              defaultValue={`[phases.setup]\nnixPkgs = ['nodejs_20', 'pnpm']\n\n[phases.build]\ncmds = ['pnpm build']`}
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
        <Input className="font-mono" defaultValue="pnpm build" />
      </Field>
      <div className="mt-2.5">
        <Field label="Output directory">
          <Input className="font-mono" defaultValue="dist" />
        </Field>
      </div>
    </Card>
  );
}

// ────── StepBuilder ──────
export function StepBuilder() {
  const form = useFormContext();
  const builderId = useStore(form.store, (s) => s.values.builderId as string);
  const name = useStore(form.store, (s) => s.values.name as string);

  return (
    <>
      <SectionHeader
        title="How should we build it?"
        sub="Auto-detected from your repo — change it if you need to"
      />

      <Card className="mt-3 border-info/40 bg-info/10 p-3.5">
        <div className="flex items-center gap-2">
          <I.check width={14} height={14} className="text-info" />
          <div className="flex-1 text-[13px]">
            <div className="font-medium text-info">Detected: {detected.framework}</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {detected.lang} · {detected.file} · resolved by {detected.detector}
            </div>
          </div>
          <Badge variant="outline" className="gap-1">
            <I.bolt width={9} height={9} />
            railpack recommended
          </Badge>
        </div>
      </Card>

      <div className="mt-3 mb-4 grid grid-cols-2 gap-2.5">
        {BUILDERS.map((b) => {
          const Ic = I[iconKey(b.icon)];
          const isActive = builderId === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => form.setFieldValue("builderId", b.id)}
              className={cn(
                "relative rounded-md border bg-card p-3.5 text-left text-foreground transition-colors hover:border-ring",
                isActive && "border-foreground bg-accent shadow-[0_0_0_1px_var(--foreground)_inset]",
              )}
            >
              {b.popular && (
                <span className="absolute top-2 right-2 rounded-sm bg-info/12 px-1.5 py-px text-[9px] font-medium uppercase tracking-[0.08em] text-info">
                  popular
                </span>
              )}
              <div className="flex items-center gap-2">
                <div className="grid size-[26px] place-items-center rounded-[5px] border bg-muted text-muted-foreground">
                  <Ic width={14} height={14} />
                </div>
                <span className="text-[13px] font-semibold">{b.name}</span>
                {isActive && (
                  <I.check width={12} height={12} className="ml-auto text-foreground" />
                )}
              </div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{b.sub}</div>
            </button>
          );
        })}
      </div>

      <SectionHeader title="Configuration" />
      <div className="mt-3">
        <BuilderConfig builderId={builderId} service={name} />
      </div>
    </>
  );
}
