import { useState } from "react";

import { createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  GitBranchIcon,
  MoreVerticalIcon,
  PlusSignIcon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";

import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/shared/components/ui/radio-group";
import { cn } from "@/shared/lib/utils";

export const Route = createFileRoute("/_app/$orgSlug/git-providers")({
  staticData: { crumb: "Git providers" },
  component: GitProvidersRoute,
});

type ProviderKind = "github" | "gitlab" | "gitea" | "bitbucket";
type AuthMethod = "oauth" | "pat";
type ProviderStatus = "active" | "warn" | "err";

interface Provider {
  id: string;
  kind: ProviderKind;
  name: string;
  instance?: string;
  auth?: AuthMethod;
  scopes?: string[];
  repos?: number;
  webhooks?: number;
  lastSync?: string;
  status?: ProviderStatus;
  connected: boolean;
}

const PROVIDER_LABEL: Record<ProviderKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
};

const PROVIDER_SEARCH: Record<ProviderKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  gitea: "Gitea",
  bitbucket: "Bitbucket",
};

const rid = () => Math.random().toString(36).slice(2, 8);

const INITIAL: Provider[] = [
  {
    id: "git_" + rid(),
    kind: "github",
    name: "GitHub",
    instance: "github.com/paperhouse",
    auth: "oauth",
    scopes: ["repo", "workflow", "admin:repo_hook"],
    repos: 14,
    webhooks: 12,
    lastSync: "2m ago",
    status: "active",
    connected: true,
  },
  {
    id: "git_" + rid(),
    kind: "gitlab",
    name: "GitLab self-hosted",
    instance: "git.helio.so",
    auth: "pat",
    scopes: ["api", "read_repository", "write_repository"],
    repos: 4,
    webhooks: 4,
    lastSync: "18h ago",
    status: "active",
    connected: true,
  },
  { id: "git_" + rid(), kind: "gitea", name: "Gitea", connected: false },
  { id: "git_" + rid(), kind: "bitbucket", name: "Bitbucket", connected: false },
];

function GitProvidersRoute() {
  const [providers] = useState<Provider[]>(INITIAL);
  const [open, setOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">
            Git providers
          </h1>
          <p className="text-[12.5px] text-muted-foreground">
            Source control connections used to deploy services on push.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
          Connect provider
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {providers.map((p) =>
          p.connected ? (
            <ConnectedCard key={p.id} p={p} />
          ) : (
            <DisconnectedCard
              key={p.id}
              p={p}
              onConnect={() => setOpen(true)}
            />
          ),
        )}
      </div>

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Each connection installs a webhook on the upstream so pushes trigger
        builds. Tokens are stored encrypted with the cluster KMS.
      </p>

      <ConnectDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function ProviderLogo({
  kind,
  size = 28,
}: {
  kind: ProviderKind;
  size?: number;
}) {
  return (
    <SvglLogo
      search={PROVIDER_SEARCH[kind]}
      fallback={PROVIDER_LABEL[kind]}
      size={size}
    />
  );
}

const STATUS_TONE: Record<ProviderStatus, string> = {
  active: "bg-success/15 text-success border-success/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  err: "bg-destructive/15 text-destructive border-destructive/30",
};

const STATUS_LABEL: Record<ProviderStatus, string> = {
  active: "active",
  warn: "degraded",
  err: "down",
};

function StatusBadge({ status }: { status: ProviderStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        STATUS_TONE[status],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function ConnectedCard({ p }: { p: Provider }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-start gap-3">
        <ProviderLogo kind={p.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold">{p.name}</span>
            {p.status && <StatusBadge status={p.status} />}
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
              {p.auth === "oauth" ? "OAuth" : "PAT"}
            </span>
          </div>
          {p.instance && (
            <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
              {p.instance}
            </div>
          )}
          {p.scopes && p.scopes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {p.scopes.map((s) => (
                <span
                  key={s}
                  className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline">
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
            Reconnect
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
            Disconnect
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="More">
            <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
          </Button>
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-6 border-t pt-3">
        <Stat label="Repos" value={String(p.repos ?? 0)} />
        <Stat label="Webhooks" value={`${p.webhooks ?? 0} active`} />
        <Stat label="Last sync" value={p.lastSync ?? "—"} mono />
        <div className="flex-1" />
        <Button size="sm" variant="ghost">
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
          Sync now
        </Button>
      </div>
    </div>
  );
}

function DisconnectedCard({
  p,
  onConnect,
}: {
  p: Provider;
  onConnect: () => void;
}) {
  return (
    <div className="rounded-md border bg-card p-3.5">
      <div className="flex items-center gap-3">
        <ProviderLogo kind={p.kind} size={24} />
        <div className="flex flex-1 items-center gap-2">
          <span className="text-[13px] font-semibold">{p.name}</span>
          <span className="inline-flex items-center gap-1 rounded-sm border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span className="size-1.5 rounded-full bg-muted-foreground/60" />
            not connected
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={onConnect}>
          Connect
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn("mt-0.5 text-[12px]", mono && "font-mono")}
      >
        {value}
      </div>
    </div>
  );
}

function ConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [kind, setKind] = useState<ProviderKind>("github");
  const [auth, setAuth] = useState<AuthMethod>("oauth");
  const [token, setToken] = useState("");
  const [instance, setInstance] = useState("");
  const [scopes, setScopes] = useState<string[]>(["repo", "workflow"]);
  const [secret] = useState(() => "whsec_" + rid() + rid());
  const [copied, setCopied] = useState(false);

  const showInstance = kind === "gitlab" || kind === "gitea";
  const allScopes = scopesFor(kind);

  const toggleScope = (s: string) =>
    setScopes((cur) =>
      cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
    );

  const copySecret = () => {
    navigator.clipboard?.writeText(secret).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} className="size-3.5" />
            Connect Git provider
          </DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-4 overflow-auto pr-1">
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Provider
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(["github", "gitlab", "gitea", "bitbucket"] as ProviderKind[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-md border bg-background p-2.5 text-[12px] font-medium transition-colors hover:bg-accent",
                    kind === k && "border-primary bg-accent ring-2 ring-primary/20",
                  )}
                >
                  <ProviderLogo kind={k} size={26} />
                  <span>{PROVIDER_LABEL[k]}</span>
                </button>
              ))}
            </div>
          </div>

          {showInstance && (
            <FieldRow label="Instance URL">
              <Input
                className="font-mono text-[12.5px]"
                placeholder={
                  kind === "gitlab" ? "git.example.com" : "gitea.example.com"
                }
                value={instance}
                onChange={(e) => setInstance(e.target.value)}
              />
            </FieldRow>
          )}

          <FieldRow label="Authentication method">
            <RadioGroup
              value={auth}
              onValueChange={(v) => setAuth(v as AuthMethod)}
              className="grid-cols-2"
            >
              <AuthOption value="oauth" current={auth} label="OAuth (recommended)" />
              <AuthOption value="pat" current={auth} label="Personal access token" />
            </RadioGroup>
          </FieldRow>

          {auth === "pat" && (
            <FieldRow label="Token">
              <Input
                type="password"
                className="font-mono text-[12.5px]"
                placeholder="ghp_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </FieldRow>
          )}

          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Scopes
            </div>
            <div className="flex flex-col gap-0.5">
              {allScopes.map((s) => (
                <label
                  key={s}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-accent"
                >
                  <Checkbox
                    checked={scopes.includes(s)}
                    onCheckedChange={() => toggleScope(s)}
                  />
                  <span className="font-mono text-[12.5px]">{s}</span>
                </label>
              ))}
            </div>
          </div>

          <FieldRow label="Webhook secret (auto-generated)">
            <div className="flex items-center gap-2">
              <Input className="flex-1 font-mono text-[12.5px]" value={secret} readOnly />
              <Button size="sm" variant="outline" onClick={copySecret}>
                <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} />
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </FieldRow>
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            Token is encrypted with the cluster KMS before storage.
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Connect
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function AuthOption({
  value,
  current,
  label,
}: {
  value: AuthMethod;
  current: AuthMethod;
  label: string;
}) {
  const active = value === current;
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-[12.5px]",
        active && "border-primary bg-accent ring-2 ring-primary/20",
      )}
    >
      <RadioGroupItem value={value} />
      <span>{label}</span>
    </label>
  );
}

function scopesFor(kind: ProviderKind): string[] {
  switch (kind) {
    case "github":
      return ["repo", "workflow", "admin:repo_hook", "read:user"];
    case "gitlab":
      return ["api", "read_repository", "write_repository", "read_user"];
    case "gitea":
      return ["repo", "admin:repo_hook", "read:user"];
    case "bitbucket":
      return ["repository", "webhook", "account"];
  }
}
