// Step_Source — where the code lives: GitHub, GitLab, Gitea, Public Git URL, CLI push.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 706-1042.
// Adapted from local useState to tanstack-form AnyFieldApi props.
import type { AnyFieldApi } from "@tanstack/react-form";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GitBranchIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Card } from "@/shared/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/shared/components/ui/input-group";
import { I } from "./icons";
import { SectionH, Field, Switch3 } from "./form-primitives";

type SourceProps = {
  srcField: AnyFieldApi;
  repoField: AnyFieldApi;
  branchField: AnyFieldApi;
  rootField: AnyFieldApi;
  autoDeployField: AnyFieldApi;
  previewBranchesField: AnyFieldApi;
  nameField: AnyFieldApi;
};

const sources = [
  {
    id: "github",
    name: "GitHub",
    sub: "Push-to-deploy · webhooks installed",
    icon: "branch",
  },
  {
    id: "gitlab",
    name: "GitLab",
    sub: "Self-hosted or SaaS",
    icon: "branch",
  },
  {
    id: "gitea",
    name: "Gitea / Forgejo",
    sub: "Any self-hosted Git provider",
    icon: "branch",
  },
  {
    id: "pubgit",
    name: "Public Git URL",
    sub: "Read-only · manual deploy from URL",
    icon: "link",
  },
  {
    id: "cli",
    name: "Push from CLI",
    sub: "otterstack push from local",
    icon: "doc",
  },
];

const recent = [
  {
    repo: "paperhouse/helio",
    stars: 142,
    lang: "TypeScript",
    updated: "2h ago",
  },
  { repo: "paperhouse/notify", stars: 23, lang: "Go", updated: "1d ago" },
  {
    repo: "paperhouse/admin",
    stars: 8,
    lang: "TypeScript",
    updated: "3d ago",
  },
  {
    repo: "paperhouse/scheduler",
    stars: 4,
    lang: "Python",
    updated: "1w ago",
  },
];

const sourceBrandSearch = (id: string): string | null =>
  id === "github"
    ? "GitHub"
    : id === "gitlab"
      ? "GitLab"
      : id === "gitea"
        ? "Gitea"
        : null;

const iconKey = (raw: string): keyof typeof I =>
  (raw as keyof typeof I) in I ? (raw as keyof typeof I) : "doc";

export function StepSource({
  srcField,
  repoField,
  branchField,
  rootField,
  autoDeployField,
  previewBranchesField,
  nameField,
}: SourceProps) {
  const src = srcField.state.value as string;
  const repo = repoField.state.value as string;
  const branch = branchField.state.value as string;
  const root = rootField.state.value as string;
  const autoDeploy = autoDeployField.state.value as boolean;
  const previewBranches = previewBranchesField.state.value as boolean;
  const name = nameField.state.value as string;

  return (
    <>
      <SectionH title="Where does the code live?" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginTop: 12,
        }}
      >
        {sources.map((s) => {
          const Ic = I[iconKey(s.icon)];
          const svgl = sourceBrandSearch(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => srcField.handleChange(s.id)}
              className={`os-builder ${src === s.id ? "active" : ""}`}
            >
              <div className="flex items-center gap-2">
                <div className="os-builder-icon">
                  {svgl ? (
                    <SvglLogo
                      search={svgl}
                      fallback={s.name}
                      size={16}
                      background="transparent"
                      border="0"
                      color="currentColor"
                      style={{ borderRadius: 0 }}
                    />
                  ) : (
                    <Ic width={13} height={13} />
                  )}
                </div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
              </div>
              <div
                className="text-muted-foreground"
                style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}
              >
                {s.sub}
              </div>
            </button>
          );
        })}
      </div>

      {src === "github" && (
        <>
          <div className="h-[22px]" />
          <SectionH title="Repository" />
          <Card className="mt-2.5 gap-0 overflow-hidden p-0">
            <InputGroup className="rounded-none border-x-0 border-t-0 border-b shadow-none">
              <InputGroupAddon>
                <HugeiconsIcon
                  icon={Search01Icon}
                  strokeWidth={2}
                  className="size-4 text-muted-foreground"
                />
              </InputGroupAddon>
              <InputGroupInput
                className="font-mono"
                placeholder="search repositories…"
                defaultValue={repo}
                onChange={(e) => repoField.handleChange(e.target.value)}
              />
              <InputGroupAddon align="inline-end">
                <Badge variant="outline" className="font-normal">
                  paperhouse · github app
                </Badge>
              </InputGroupAddon>
            </InputGroup>
            <div className="max-h-56 overflow-y-auto">
              {recent.map((r) => {
                const isSelected = repo === r.repo;
                return (
                  <button
                    key={r.repo}
                    type="button"
                    onClick={() => repoField.handleChange(r.repo)}
                    aria-pressed={isSelected}
                    className={`flex w-full items-center gap-3 border-b border-border/60 px-3 py-2 text-left text-foreground last:border-b-0 transition-colors hover:bg-accent/40 ${
                      isSelected ? "bg-accent" : ""
                    }`}
                  >
                    <HugeiconsIcon
                      icon={GitBranchIcon}
                      strokeWidth={2}
                      className="size-3.5 shrink-0 text-muted-foreground"
                    />
                    <span className="flex-1 font-mono text-[13px]">{r.repo}</span>
                    <Badge variant="secondary" className="font-normal">
                      {r.lang}
                    </Badge>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      ★ {r.stars} · {r.updated}
                    </span>
                    {isSelected && (
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        strokeWidth={2}
                        className="size-3.5 text-success"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </Card>

          <div style={{ height: 18 }} />
          <SectionH title="Configuration" />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
              }}
            >
              <Field label="Branch">
                <select
                  className="input font-mono"
                  value={branch}
                  onChange={(e) => branchField.handleChange(e.target.value)}
                >
                  <option>main</option>
                  <option>develop</option>
                  <option>staging</option>
                </select>
              </Field>
              <Field label="Root directory">
                <input
                  className="input font-mono"
                  value={root}
                  onChange={(e) => rootField.handleChange(e.target.value)}
                />
              </Field>
            </div>
            <div style={{ height: 12 }} />
            <Field label="Service name">
              <input
                className="input font-mono"
                value={name}
                onChange={(e) => nameField.handleChange(e.target.value)}
              />
              <div
                className="text-muted-foreground"
                style={{ fontSize: 11, marginTop: 4 }}
              >
                Used in DNS —{" "}
                <span className="font-mono" style={{ color: "var(--fg-2)" }}>
                  {name}.helio.internal
                </span>
              </div>
            </Field>
            <div style={{ height: 14 }} />

            {/* autoDeploy — controlled via field */}
            <div
              className="flex items-center gap-3"
              style={{
                padding: "10px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  Auto-deploy on push
                </div>
                <div
                  className="text-muted-foreground"
                  style={{ fontSize: 11 }}
                >
                  Trigger a deploy whenever {branch} updates
                </div>
              </div>
              <Switch3
                on={autoDeploy}
                onChange={(v) => autoDeployField.handleChange(v)}
              />
            </div>

            {/* previewBranches — controlled via field */}
            <div
              className="flex items-center gap-3"
              style={{
                padding: "10px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  Preview deploys for pull requests
                </div>
                <div
                  className="text-muted-foreground"
                  style={{ fontSize: 11 }}
                >
                  Spin up a temporary environment for every PR
                </div>
              </div>
              <Switch3
                on={previewBranches}
                onChange={(v) => previewBranchesField.handleChange(v)}
              />
            </div>

            {/* deploy-only-when-watched — uncontrolled, display-only toggle */}
            <div
              className="flex items-center gap-3"
              style={{
                padding: "10px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  Deploy only when watched paths change
                </div>
                <div
                  className="text-muted-foreground"
                  style={{ fontSize: 11 }}
                >
                  Skip rebuilds unless files in {root}/ are modified
                </div>
              </div>
              <Switch3 on={true} />
            </div>
          </div>
        </>
      )}

      {src === "pubgit" && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <Field label="Public Git URL">
            <input
              className="input font-mono"
              placeholder="https://github.com/owner/repo.git"
            />
          </Field>
          <div style={{ height: 10 }} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
            }}
          >
            <Field label="Branch / tag / commit">
              <input className="input font-mono" defaultValue="main" />
            </Field>
            <Field label="Service name">
              <input
                className="input font-mono"
                value={name}
                onChange={(e) => nameField.handleChange(e.target.value)}
              />
            </Field>
          </div>
        </div>
      )}

      {src === "cli" && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <div
            className="text-muted-foreground"
            style={{ fontSize: 12, marginBottom: 10 }}
          >
            Push from your terminal — no Git provider required.
          </div>
          <pre
            className="font-mono"
            style={{
              background: "var(--bg-sunken)",
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              border: "1px solid var(--border)",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            {`# 1. install once
$ curl -fsSL https://otterstack.dev/install.sh | sh

# 2. authenticate
$ otterstack login

# 3. push from your project
$ otterstack push --service ${name} --env production`}
          </pre>
          <div style={{ height: 12 }} />
          <Field label="Service name">
            <input
              className="input font-mono"
              value={name}
              onChange={(e) => nameField.handleChange(e.target.value)}
            />
          </Field>
        </div>
      )}
    </>
  );
}
