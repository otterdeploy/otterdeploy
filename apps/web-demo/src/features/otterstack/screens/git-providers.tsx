// Git providers — connected source control integrations + Connect modal.

import { useEffect, useState } from "react";

import { SvglLogo } from "@/components/brand/svgl-logo";
import { I } from "../icons";
import { rid } from "../data";
import { Field, SectionH } from "../components/form";
import { StatusBadge } from "../components/status-badge";

type ProviderKind = "github" | "gitlab" | "gitea" | "bitbucket";
type AuthMethod = "oauth" | "pat";

type Provider = {
  id: string;
  kind: ProviderKind;
  name: string;
  instance?: string;
  auth?: AuthMethod;
  scopes?: string[];
  repos?: number;
  webhooks?: number;
  lastSync?: string;
  status?: "active" | "warn" | "err";
  connected: boolean;
};

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

export function GitProviders() {
  const [providers] = useState<Provider[]>(INITIAL);
  const [open, setOpen] = useState(false);

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <SectionH
            title="Git providers"
            sub="Source control connections used to deploy services on push"
          />
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => setOpen(true)}>
            <I.plus width={12} height={12} /> Connect provider
          </button>
        </div>

        <div className="col gap-3">
          {providers.map((p) =>
            p.connected ? (
              <ConnectedCard key={p.id} p={p} />
            ) : (
              <DisconnectedCard key={p.id} p={p} onConnect={() => setOpen(true)} />
            ),
          )}
        </div>

        <div className="muted" style={{ fontSize: 11, marginTop: 14, lineHeight: 1.6 }}>
          Each connection installs a webhook on the upstream so pushes trigger
          builds. Tokens are stored encrypted with the cluster KMS.
        </div>
      </div>

      {open && <ConnectModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function ProviderLogo({ kind, size = 28 }: { kind: ProviderKind; size?: number }) {
  return (
    <SvglLogo
      search={PROVIDER_SEARCH[kind]}
      fallback={PROVIDER_LABEL[kind]}
      size={size}
      background="var(--bg-sunken)"
      color="var(--fg)"
      border="1px solid var(--border)"
    />
  );
}

function ConnectedCard({ p }: { p: Provider }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row gap-3" style={{ alignItems: "flex-start" }}>
        <ProviderLogo kind={p.kind} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
            {p.status && <StatusBadge status={p.status} />}
            <span
              className="badge"
              style={{ background: "var(--bg-overlay)", color: "var(--fg-2)" }}
            >
              {p.auth === "oauth" ? "OAuth" : "PAT"}
            </span>
          </div>
          {p.instance && (
            <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>
              {p.instance}
            </div>
          )}
          {p.scopes && (
            <div className="row gap-1" style={{ flexWrap: "wrap", marginTop: 8 }}>
              {p.scopes.map((s) => (
                <span
                  key={s}
                  className="mono"
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    borderRadius: 3,
                    background: "var(--bg-overlay)",
                    color: "var(--fg-3)",
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="row gap-1">
          <button className="btn sm">
            <I.refresh width={11} height={11} /> Reconnect
          </button>
          <button className="btn sm ghost" style={{ color: "var(--err)" }}>
            Disconnect
          </button>
          <button className="btn ghost icon sm">
            <I.more width={12} height={12} />
          </button>
        </div>
      </div>

      <div
        className="row gap-4"
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
        }}
      >
        <Stat label="repos" value={String(p.repos ?? 0)} />
        <Stat label="webhooks" value={`${p.webhooks ?? 0} active`} />
        <Stat label="last sync" value={p.lastSync ?? "—"} mono />
        <div style={{ flex: 1 }} />
        <button className="btn sm ghost">
          <I.refresh width={11} height={11} /> Sync now
        </button>
      </div>
    </div>
  );
}

function DisconnectedCard({ p, onConnect }: { p: Provider; onConnect: () => void }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row gap-3" style={{ alignItems: "center" }}>
        <ProviderLogo kind={p.kind} size={24} />
        <div style={{ flex: 1 }}>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</span>
            <span
              className="badge"
              style={{ color: "var(--fg-3)" }}
            >
              <span
                className="dot"
                style={{ background: "var(--fg-4)" }}
              />
              not connected
            </span>
          </div>
        </div>
        <button className="btn sm" onClick={onConnect}>
          Connect
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div
        className="muted"
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </div>
      <div
        className={mono ? "mono" : undefined}
        style={{ fontSize: 12, color: "var(--fg)", marginTop: 2 }}
      >
        {value}
      </div>
    </div>
  );
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<ProviderKind>("github");
  const [auth, setAuth] = useState<AuthMethod>("oauth");
  const [token, setToken] = useState("");
  const [instance, setInstance] = useState("");
  const [scopes, setScopes] = useState<string[]>(["repo", "workflow"]);
  const [secret] = useState(() => "whsec_" + rid() + rid());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const showInstance = kind === "gitlab" || kind === "gitea";
  const allScopes = scopesFor(kind);

  const toggleScope = (s: string) =>
    setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const copySecret = () => {
    navigator.clipboard?.writeText(secret).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "grid",
        placeItems: "center",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="os-modal"
        style={{ width: 580 }}
      >
        <div className="row gap-2 os-modal-h">
          <I.branch width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Connect Git provider</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div
          className="col gap-3"
          style={{ padding: 18, overflow: "auto", maxHeight: "65vh" }}
        >
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Provider
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
              }}
            >
              {(["github", "gitlab", "gitea", "bitbucket"] as ProviderKind[]).map(
                (k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={`os-builder ${kind === k ? "active" : ""}`}
                    style={{ padding: 10, alignItems: "center", textAlign: "center" }}
                  >
                    <div className="col gap-1" style={{ alignItems: "center" }}>
                      <ProviderLogo kind={k} size={26} />
                      <span style={{ fontSize: 12, fontWeight: 500 }}>
                        {PROVIDER_LABEL[k]}
                      </span>
                    </div>
                  </button>
                ),
              )}
            </div>
          </div>

          {showInstance && (
            <Field label="Instance URL">
              <input
                className="input mono"
                placeholder={kind === "gitlab" ? "git.example.com" : "gitea.example.com"}
                value={instance}
                onChange={(e) => setInstance(e.target.value)}
              />
            </Field>
          )}

          <Field label="Authentication method">
            <div className="row gap-2">
              <label
                className="row gap-2"
                style={{ flex: 1, padding: 8, border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
              >
                <input
                  type="radio"
                  name="auth"
                  checked={auth === "oauth"}
                  onChange={() => setAuth("oauth")}
                />
                <span style={{ fontSize: 12 }}>OAuth (recommended)</span>
              </label>
              <label
                className="row gap-2"
                style={{ flex: 1, padding: 8, border: "1px solid var(--border)", borderRadius: 6, cursor: "pointer" }}
              >
                <input
                  type="radio"
                  name="auth"
                  checked={auth === "pat"}
                  onChange={() => setAuth("pat")}
                />
                <span style={{ fontSize: 12 }}>Personal access token</span>
              </label>
            </div>
          </Field>

          {auth === "pat" && (
            <Field label="Token">
              <input
                className="input mono"
                type="password"
                placeholder="ghp_…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>
          )}

          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Scopes
            </div>
            <div className="col gap-1">
              {allScopes.map((s) => (
                <label
                  key={s}
                  className="row gap-2"
                  style={{ padding: "6px 8px", borderRadius: 4, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={scopes.includes(s)}
                    onChange={() => toggleScope(s)}
                  />
                  <span className="mono" style={{ fontSize: 12 }}>
                    {s}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <Field label="Webhook secret (auto-generated)">
            <div className="row gap-2">
              <input className="input mono" value={secret} readOnly style={{ flex: 1 }} />
              <button className="btn" onClick={copySecret}>
                <I.copy width={11} height={11} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </Field>
        </div>

        <div
          className="row gap-2"
          style={{ padding: 14, borderTop: "1px solid var(--border)" }}
        >
          <span className="muted" style={{ fontSize: 11 }}>
            Token is encrypted with the cluster KMS before storage.
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={onClose}>
            Connect
          </button>
        </div>
      </div>
    </div>
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
