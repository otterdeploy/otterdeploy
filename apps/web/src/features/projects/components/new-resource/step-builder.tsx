// Step_Builder — builder picker + per-builder config.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1042–1143
// and apps/web-demo/src/features/otterstack/components/form.tsx (BuilderConfig).
// Adapted from local useState to tanstack-form AnyFieldApi props.
import type { AnyFieldApi } from "@tanstack/react-form";
import { I, type IconKey } from "./icons";
import { SectionH, Field } from "./form-primitives";

// ────── Types ──────
type Builder = {
  id: string;
  name: string;
  sub: string;
  icon: string;
  popular?: boolean;
  langs?: string[];
};

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

// ────── BuilderConfig ──────
function BuilderConfig({
  builderId,
  service,
}: {
  builderId: string;
  service: string;
}) {
  if (builderId === "railpack") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
          <I.bolt width={14} height={14} style={{ color: "var(--muted-foreground)" }} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Railpack auto-detect</span>
          <span className="badge ok">
            <span className="dot" />
            Node 20 detected
          </span>
        </div>
        <div
          className="text-muted-foreground"
          style={{ fontSize: 12, marginBottom: 14 }}
        >
          Railpack inspects your repo and assembles an OCI image automatically.
          Override individual layers below if needed.
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          <Field label="Install command (override)">
            <input
              className="input font-mono"
              placeholder="auto: pnpm install --frozen-lockfile"
            />
          </Field>
          <Field label="Build command (override)">
            <input
              className="input font-mono"
              placeholder={
                service === "web" ? "auto: pnpm build" : "auto: tsc -p ."
              }
            />
          </Field>
        </div>
        <div style={{ height: 10 }} />
        <Field label="Root directory">
          <input
            className="input font-mono"
            defaultValue={`apps/${service}`}
          />
        </Field>
        <div style={{ height: 12 }} />
        <div className="text-muted-foreground" style={{ fontSize: 11 }}>
          Detected layers
        </div>
        <div
          className="card"
          style={{ padding: 10, marginTop: 6, background: "var(--muted)" }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: 11,
              lineHeight: 1.8,
              color: "var(--muted-foreground)",
            }}
          >
            <div>
              1. <span style={{ color: "var(--info)" }}>setup</span>
              {"     "}· alpine + corepack
            </div>
            <div>
              2. <span style={{ color: "var(--info)" }}>install</span>
              {"   "}· pnpm install --frozen-lockfile
            </div>
            <div>
              3. <span style={{ color: "var(--info)" }}>build</span>
              {"     "}· pnpm --filter ./apps/{service} build
            </div>
            <div>
              4. <span style={{ color: "var(--info)" }}>runtime</span>
              {"   "}· gcr.io/distroless/nodejs20-debian12
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (builderId === "dockerfile") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <I.doc
            width={14}
            height={14}
            style={{ color: "var(--muted-foreground)" }}
          />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Dockerfile</span>
        </div>
        <div
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}
        >
          <Field label="Dockerfile path">
            <input
              className="input font-mono"
              defaultValue={`apps/${service}/Dockerfile`}
            />
          </Field>
          <Field label="Build context">
            <input className="input font-mono" defaultValue="." />
          </Field>
        </div>
        <div style={{ height: 10 }} />
        <Field label="Target stage (multi-stage)">
          <input
            className="input font-mono"
            placeholder="optional · e.g. runtime"
          />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Build args (one per line, KEY=value)">
          <textarea
            className="input font-mono"
            rows={3}
            defaultValue={`NODE_VERSION=20\nGIT_SHA=$COMMIT_SHA`}
          />
        </Field>
      </div>
    );
  }

  if (builderId === "compose") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <I.service
            width={14}
            height={14}
            style={{ color: "var(--muted-foreground)" }}
          />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Docker Compose</span>
          <span className="badge">
            <I.warning width={9} height={9} /> deploys all services in
            compose.yml as a Docker Stack
          </span>
        </div>
        <Field label="Compose file">
          <input className="input font-mono" defaultValue="compose.yml" />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Profiles (comma separated)">
          <input
            className="input font-mono"
            placeholder="prod, observability"
          />
        </Field>
        <div style={{ height: 12 }} />
        <div className="text-muted-foreground" style={{ fontSize: 11 }}>
          Detected services
        </div>
        <div
          className="card"
          style={{ padding: 10, marginTop: 6, background: "var(--muted)" }}
        >
          <div className="font-mono" style={{ fontSize: 11, lineHeight: 1.8 }}>
            web (build: ./apps/web) · api (build: ./apps/api) · worker
            (build: ./apps/worker) · postgres:16 · redis:7
          </div>
        </div>
      </div>
    );
  }

  if (builderId === "buildpack") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <I.folder width={14} height={14} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>
            Cloud-Native Buildpacks
          </span>
        </div>
        <Field label="Builder image">
          <select className="input">
            <option>paketobuildpacks/builder-jammy-base:latest</option>
            <option>heroku/builder:24</option>
            <option>gcr.io/buildpacks/builder:v1</option>
          </select>
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Buildpacks (in order)">
          <textarea
            className="input font-mono"
            rows={3}
            defaultValue={`paketo-buildpacks/nodejs\npaketo-buildpacks/npm-install\npaketo-buildpacks/npm-start`}
          />
        </Field>
      </div>
    );
  }

  if (builderId === "nixpack") {
    return (
      <div className="card" style={{ padding: 18 }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 8 }}>
          <I.graph width={14} height={14} />
          <span style={{ fontWeight: 600, fontSize: 13 }}>Nixpacks</span>
        </div>
        <Field label="Nixpacks providers (comma separated)">
          <input className="input font-mono" defaultValue="node, pnpm" />
        </Field>
        <div style={{ height: 10 }} />
        <Field label="Custom nixpacks.toml">
          <textarea
            className="input font-mono"
            rows={5}
            defaultValue={`[phases.setup]\nnixPkgs = ['nodejs_20', 'pnpm']\n\n[phases.build]\ncmds = ['pnpm build']`}
          />
        </Field>
      </div>
    );
  }

  // static (default)
  return (
    <div className="card" style={{ padding: 18 }}>
      <div className="flex items-center gap-2">
        <I.globe width={14} height={14} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>Static site</span>
      </div>
      <div style={{ height: 10 }} />
      <Field label="Build command">
        <input className="input font-mono" defaultValue="pnpm build" />
      </Field>
      <div style={{ height: 10 }} />
      <Field label="Output directory">
        <input className="input font-mono" defaultValue="dist" />
      </Field>
    </div>
  );
}

// ────── Props ──────
export type BuilderProps = {
  builderIdField: AnyFieldApi;
  /** Service name — passed to BuilderConfig for placeholder paths. */
  nameField: AnyFieldApi;
};

// ────── StepBuilder ──────
export function StepBuilder({ builderIdField, nameField }: BuilderProps) {
  const builderId = builderIdField.state.value as string;
  const name = nameField.state.value as string;

  return (
    <>
      <SectionH
        title="How should we build it?"
        sub="Auto-detected from your repo — change it if you need to"
      />

      <div
        className="card"
        style={{
          padding: 14,
          marginTop: 12,
          background: "var(--info-bg)",
          borderColor: "var(--info)",
        }}
      >
        <div className="flex items-center gap-2">
          <I.check width={14} height={14} style={{ color: "var(--info)" }} />
          <div style={{ flex: 1, fontSize: 13 }}>
            <div style={{ color: "var(--info)", fontWeight: 500 }}>
              Detected: {detected.framework}
            </div>
            <div
              className="text-muted-foreground font-mono"
              style={{ fontSize: 11, marginTop: 2 }}
            >
              {detected.lang} · {detected.file} · resolved by{" "}
              {detected.detector}
            </div>
          </div>
          <span className="badge">
            <I.bolt width={9} height={9} />
            railpack recommended
          </span>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
          marginTop: 12,
          marginBottom: 18,
        }}
      >
        {BUILDERS.map((b) => {
          const Ic = I[iconKey(b.icon)];
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => builderIdField.handleChange(b.id)}
              className={`os-builder ${builderId === b.id ? "active" : ""}`}
            >
              {b.popular && <span className="os-builder-pop">popular</span>}
              <div className="flex items-center gap-2">
                <div className="os-builder-icon">
                  <Ic width={14} height={14} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</span>
                {builderId === b.id && (
                  <I.check
                    width={12}
                    height={12}
                    style={{ marginLeft: "auto", color: "var(--foreground)" }}
                  />
                )}
              </div>
              <div
                className="text-muted-foreground"
                style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}
              >
                {b.sub}
              </div>
            </button>
          );
        })}
      </div>

      <SectionH title="Configuration" />
      <div style={{ marginTop: 12 }}>
        <BuilderConfig builderId={builderId} service={name} />
      </div>
    </>
  );
}
