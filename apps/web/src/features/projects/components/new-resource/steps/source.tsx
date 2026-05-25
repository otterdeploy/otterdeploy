import { useStore } from "@tanstack/react-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon, Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Badge } from "@/shared/components/ui/badge";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/components/ui/input-group";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/lib/utils";

import {
  builderCardActiveClass,
  builderCardClass,
  builderIconClass,
  Field,
  SectionHeader,
} from "../form-primitives";
import { useFormContext } from "../form-context";
import { I } from "../icons";

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
  id === "github" ? "GitHub" : id === "gitlab" ? "GitLab" : id === "gitea" ? "Gitea" : null;

const iconKey = (raw: string): keyof typeof I =>
  (raw as keyof typeof I) in I ? (raw as keyof typeof I) : "doc";

export function StepSource() {
  const form = useFormContext();
  const src = useStore(form.store, (s) => s.values.src as string);
  const repo = useStore(form.store, (s) => s.values.repo as string);
  const branch = useStore(form.store, (s) => s.values.branch as string);
  const root = useStore(form.store, (s) => s.values.root as string);
  const autoDeploy = useStore(form.store, (s) => s.values.autoDeploy as boolean);
  const previewBranches = useStore(form.store, (s) => s.values.previewBranches as boolean);
  const name = useStore(form.store, (s) => s.values.name as string);

  return (
    <>
      <SectionHeader title="Where does the code live?" />
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {sources.map((s) => {
          const Ic = I[iconKey(s.icon)];
          const svgl = sourceBrandSearch(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => form.setFieldValue("src", s.id as "github" | "gitlab")}
              className={cn(builderCardClass, src === s.id && builderCardActiveClass)}
            >
              <div className="flex items-center gap-2">
                <div className={builderIconClass}>
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
                <span className="text-[13px] font-semibold">{s.name}</span>
              </div>
              <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
                {s.sub}
              </div>
            </button>
          );
        })}
      </div>

      {src === "github" && (
        <>
          <div className="mt-5">
            <SectionHeader title="Repository" />
          </div>
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
                onChange={(e) => form.setFieldValue("repo", e.target.value)}
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
                    onClick={() => form.setFieldValue("repo", r.repo)}
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

          <div className="mt-4.5">
            <SectionHeader title="Configuration" />
          </div>
          <Card className="mt-2.5 rounded-md">
            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2.5">
                <form.AppField name="branch">
                  {(f) => (
                    <f.SelectField
                      label="Branch"
                      items={[
                        { label: "main", value: "main" },
                        { label: "develop", value: "develop" },
                        { label: "staging", value: "staging" },
                      ]}
                      className="w-full font-mono"
                    />
                  )}
                </form.AppField>
                <form.AppField name="root">
                  {(f) => <f.TextField label="Root directory" className="font-mono" />}
                </form.AppField>
              </div>
              <form.AppField name="name">
                {(f) => (
                  <f.TextField
                    label="Service name"
                    className="font-mono"
                    description={`Used in DNS — ${name}.helio.internal`}
                  />
                )}
              </form.AppField>
              <ToggleRow
                label="Auto-deploy on push"
                description={`Trigger a deploy whenever ${branch} updates`}
                checked={autoDeploy}
                onChange={(v) => form.setFieldValue("autoDeploy", v)}
              />
              <ToggleRow
                label="Preview deploys for pull requests"
                description="Spin up a temporary environment for every PR"
                checked={previewBranches}
                onChange={(v) => form.setFieldValue("previewBranches", v)}
              />
              <ToggleRow
                label="Deploy only when watched paths change"
                description={`Skip rebuilds unless files in ${root}/ are modified`}
                checked
                readOnly
              />
            </CardContent>
          </Card>
        </>
      )}

      {src === "pubgit" && (
        <Card className="mt-4 rounded-md">
          <CardContent className="flex flex-col gap-2.5">
            <Field label="Public Git URL">
              <Input className="font-mono" placeholder="https://github.com/owner/repo.git" />
            </Field>
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Branch / tag / commit">
                <Input className="font-mono" defaultValue="main" />
              </Field>
              <Field label="Service name">
                <Input
                  className="font-mono"
                  value={name}
                  onChange={(e) => form.setFieldValue("name", e.target.value)}
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      )}

      {src === "cli" && (
        <Card className="mt-4 rounded-md">
          <CardContent className="flex flex-col gap-3">
            <div className="text-xs text-muted-foreground">
              Push from your terminal — no Git provider required.
            </div>
            <pre className="m-0 rounded-md border bg-muted p-3 font-mono text-xs leading-relaxed">
              {`# 1. install once
$ curl -fsSL https://otterstack.dev/install.sh | sh

# 2. authenticate
$ otterstack login

# 3. push from your project
$ otterstack push --service ${name} --env production`}
            </pre>
            <Field label="Service name">
              <Input
                className="font-mono"
                value={name}
                onChange={(e) => form.setFieldValue("name", e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  readOnly,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-t py-2.5">
      <div className="flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[11px] text-muted-foreground">{description}</div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={readOnly ? undefined : onChange}
        disabled={readOnly}
      />
    </div>
  );
}
