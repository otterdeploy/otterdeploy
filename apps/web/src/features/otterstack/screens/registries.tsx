// Container registries — credentials & image pull cache.

import { useEffect, useState } from "react";

import { SvglLogo } from "@/components/brand/svgl-logo";
import { I } from "../icons";
import { Field, SectionH } from "../components/form";
import { StatusBadge } from "../components/status-badge";

type RegistryKind =
  | "dockerhub"
  | "ghcr"
  | "ecr"
  | "gcr"
  | "gar"
  | "acr"
  | "harbor"
  | "generic";

type AuthKind = "anonymous" | "basic" | "token" | "iam" | "cloud";

type Registry = {
  id: string;
  kind: RegistryKind;
  name: string;
  url: string;
  auth: AuthKind;
  authDetail?: string;
  images: number;
  lastPulled?: string;
  status: "active" | "warn" | "err";
  statusNote?: string;
};

const REGISTRY_LABEL: Record<RegistryKind, string> = {
  dockerhub: "Docker Hub",
  ghcr: "GHCR",
  ecr: "AWS ECR",
  gcr: "GCR",
  gar: "GAR",
  acr: "ACR",
  harbor: "Harbor",
  generic: "Generic",
};

const REGISTRY_SEARCH: Partial<Record<RegistryKind, string>> = {
  dockerhub: "Docker",
  ghcr: "GitHub",
  ecr: "AWS",
  gcr: "Google Cloud",
  gar: "Google Cloud",
  acr: "Azure",
  harbor: "Harbor",
};

const INITIAL: Registry[] = [
  {
    id: "reg_dockerhub",
    kind: "dockerhub",
    name: "Docker Hub",
    url: "docker.io",
    auth: "anonymous",
    authDetail: "anonymous pull",
    images: 18,
    lastPulled: "31m ago",
    status: "active",
  },
  {
    id: "reg_ghcr",
    kind: "ghcr",
    name: "GitHub Container Registry",
    url: "ghcr.io",
    auth: "token",
    authDetail: "PAT · paperhouse",
    images: 7,
    lastPulled: "4m ago",
    status: "active",
  },
  {
    id: "reg_ecr",
    kind: "ecr",
    name: "AWS ECR",
    url: "123456789012.dkr.ecr.us-west-2.amazonaws.com",
    auth: "iam",
    authDetail: "arn:aws:iam::123456789012:role/otterstack-pull",
    images: 3,
    lastPulled: "1h ago",
    status: "active",
  },
  {
    id: "reg_harbor",
    kind: "harbor",
    name: "Self-hosted Harbor",
    url: "registry.helio.internal",
    auth: "basic",
    authDetail: "basic · ci-pull",
    images: 9,
    lastPulled: "12m ago",
    status: "warn",
    statusNote: "cert expires in 12d",
  },
];

export function Registries() {
  const [registries] = useState<Registry[]>(INITIAL);
  const [open, setOpen] = useState(false);

  const totalImages = registries.reduce((n, r) => n + r.images, 0);

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <SectionH
            title="Container registries"
            sub="Pull credentials for images used by services and stacks"
          />
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={() => setOpen(true)}>
            <I.plus width={12} height={12} /> Add registry
          </button>
        </div>

        <div className="col gap-3">
          {registries.map((r) => (
            <RegistryCard key={r.id} r={r} />
          ))}
        </div>

        <div style={{ height: 22 }} />
        <SectionH title="Image pull cache" />
        <div className="card" style={{ padding: 14, marginTop: 12 }}>
          <div className="row gap-4">
            <Stat label="cached images" value={String(totalImages + 6)} />
            <Stat label="disk used" value="4.2 GB" mono />
            <Stat label="hit rate (24h)" value="91%" mono />
            <div style={{ flex: 1 }} />
            <button className="btn sm">
              <I.trash width={11} height={11} /> Clear cache
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
            Layers are cached on each swarm node. Pruned automatically when disk
            usage exceeds 80%.
          </div>
        </div>
      </div>

      {open && <AddRegistryModal onClose={() => setOpen(false)} />}
    </div>
  );
}

function RegistryLogo({ kind, size = 32 }: { kind: RegistryKind; size?: number }) {
  return (
    <SvglLogo
      search={REGISTRY_SEARCH[kind] ?? REGISTRY_LABEL[kind]}
      fallback={REGISTRY_LABEL[kind]}
      size={size}
      background="var(--bg-sunken)"
      color="var(--fg)"
      border="1px solid var(--border)"
    />
  );
}

function RegistryCard({ r }: { r: Registry }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row gap-3" style={{ alignItems: "flex-start" }}>
        <RegistryLogo kind={r.kind} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</span>
            <StatusBadge status={r.status === "warn" ? "degraded" : "active"}>
              {r.status === "warn" ? r.statusNote ?? "warning" : "active"}
            </StatusBadge>
            <span
              className="badge"
              style={{ background: "var(--bg-overlay)", color: "var(--fg-2)" }}
            >
              {authLabel(r.auth)}
            </span>
          </div>
          <div
            className="mono muted"
            style={{
              fontSize: 11,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {r.url}
          </div>
          {r.authDetail && (
            <div
              className="mono"
              style={{
                fontSize: 11,
                marginTop: 4,
                color: "var(--fg-3)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {r.authDetail}
            </div>
          )}
        </div>
        <div className="row gap-1">
          <button className="btn sm">
            <I.bolt width={11} height={11} /> Test connection
          </button>
          <button className="btn sm ghost">
            <I.edit width={11} height={11} /> Edit
          </button>
          <button className="btn sm ghost" style={{ color: "var(--err)" }}>
            <I.trash width={11} height={11} /> Remove
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
        <Stat label="images" value={String(r.images)} />
        <Stat label="last pulled" value={r.lastPulled ?? "—"} mono />
        <div style={{ flex: 1 }} />
        <button className="btn sm ghost">
          <I.refresh width={11} height={11} /> Refresh tags
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

function authLabel(a: AuthKind): string {
  switch (a) {
    case "anonymous":
      return "anonymous";
    case "basic":
      return "basic auth";
    case "token":
      return "token";
    case "iam":
      return "IAM role";
    case "cloud":
      return "cloud-provider";
  }
}

function defaultUrlFor(kind: RegistryKind): string {
  switch (kind) {
    case "dockerhub":
      return "docker.io";
    case "ghcr":
      return "ghcr.io";
    case "ecr":
      return "<acct>.dkr.ecr.<region>.amazonaws.com";
    case "gcr":
      return "gcr.io";
    case "gar":
      return "<region>-docker.pkg.dev";
    case "acr":
      return "<name>.azurecr.io";
    case "harbor":
      return "registry.example.com";
    case "generic":
      return "registry.example.com";
  }
}

function defaultAuthFor(kind: RegistryKind): AuthKind {
  switch (kind) {
    case "dockerhub":
    case "generic":
      return "anonymous";
    case "ghcr":
      return "token";
    case "ecr":
    case "gcr":
    case "gar":
    case "acr":
      return "cloud";
    case "harbor":
      return "basic";
  }
}

function AddRegistryModal({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<RegistryKind>("dockerhub");
  const [url, setUrl] = useState(defaultUrlFor("dockerhub"));
  const [auth, setAuth] = useState<AuthKind>(defaultAuthFor("dockerhub"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [iamRole, setIamRole] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const onPickKind = (k: RegistryKind) => {
    setKind(k);
    setUrl(defaultUrlFor(k));
    setAuth(defaultAuthFor(k));
  };

  const allKinds: RegistryKind[] = [
    "dockerhub",
    "ghcr",
    "ecr",
    "gcr",
    "gar",
    "acr",
    "harbor",
    "generic",
  ];

  const allAuths: AuthKind[] = ["anonymous", "basic", "token", "iam", "cloud"];

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
        style={{ width: 600 }}
      >
        <div className="row gap-2 os-modal-h">
          <I.server width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Add container registry</span>
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
              Type
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
              }}
            >
              {allKinds.map((k) => (
                <button
                  key={k}
                  onClick={() => onPickKind(k)}
                  className={`os-builder ${kind === k ? "active" : ""}`}
                  style={{ padding: 10, alignItems: "center", textAlign: "center" }}
                >
                  <div className="col gap-1" style={{ alignItems: "center" }}>
                    <RegistryLogo kind={k} size={26} />
                    <span style={{ fontSize: 11, fontWeight: 500 }}>
                      {REGISTRY_LABEL[k]}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <Field label="Registry URL">
            <input
              className="input mono"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>

          <Field label="Authentication">
            <select
              className="input"
              value={auth}
              onChange={(e) => setAuth(e.target.value as AuthKind)}
            >
              {allAuths.map((a) => (
                <option key={a} value={a}>
                  {authLabel(a)}
                </option>
              ))}
            </select>
          </Field>

          {auth === "basic" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Username">
                <input
                  className="input mono"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>
              <Field label="Password">
                <input
                  className="input mono"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            </div>
          )}

          {auth === "token" && (
            <Field label="Token">
              <input
                className="input mono"
                type="password"
                placeholder="ghp_… / glpat-…"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </Field>
          )}

          {auth === "iam" && (
            <Field label="IAM role ARN">
              <input
                className="input mono"
                placeholder="arn:aws:iam::123456789012:role/otterstack-pull"
                value={iamRole}
                onChange={(e) => setIamRole(e.target.value)}
              />
            </Field>
          )}

          {auth === "cloud" && (
            <div
              className="card"
              style={{
                padding: 12,
                background: "var(--bg-sunken)",
                fontSize: 12,
                color: "var(--fg-2)",
                lineHeight: 1.6,
              }}
            >
              Otterstack will use the swarm node&apos;s instance metadata
              credentials to authenticate pulls. No keys stored.
            </div>
          )}

          {auth === "anonymous" && (
            <div
              className="card"
              style={{
                padding: 12,
                background: "var(--bg-sunken)",
                fontSize: 12,
                color: "var(--fg-2)",
              }}
            >
              Public images only · subject to upstream rate limits.
            </div>
          )}
        </div>

        <div
          className="row gap-2"
          style={{ padding: 14, borderTop: "1px solid var(--border)" }}
        >
          <button className="btn sm ghost">
            <I.bolt width={11} height={11} /> Test connection
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={onClose}>
            Test &amp; save
          </button>
        </div>
      </div>
    </div>
  );
}
