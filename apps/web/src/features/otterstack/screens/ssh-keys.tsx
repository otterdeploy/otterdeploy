// SSH keys — Git pulls + swarm node management.

import { useEffect, useMemo, useState } from "react";

import { I } from "../icons";
import { rid } from "../data";
import { Field, SectionH } from "../components/form";

type KeyType = "ed25519" | "rsa" | "ecdsa";

type UsedBy = { kind: "git" | "node" | "service"; label: string };

type SshKey = {
  id: string;
  name: string;
  type: KeyType;
  bits?: number;
  fingerprint: string;
  usedBy: UsedBy[];
  generated: string;
  lastUsed?: string;
  imported?: boolean;
  warn?: string;
};

const INITIAL: SshKey[] = [
  {
    id: "key_" + rid(),
    name: "otterstack-deploy",
    type: "ed25519",
    bits: 4096,
    fingerprint: "SHA256:Ad7QmKv9b3xRjW2NfqL4tGc8eUpBnY1HsZkXoVrwZk=",
    usedBy: [
      { kind: "git", label: "GitHub" },
      { kind: "git", label: "GitLab" },
      { kind: "git", label: "Gitea" },
    ],
    generated: "62d ago",
    lastUsed: "2m ago",
  },
  {
    id: "key_" + rid(),
    name: "helio-prod-managers",
    type: "ed25519",
    fingerprint: "SHA256:Pq2RmNk9c8sTjBh4LfXg6vQc7eUtBnY3HwZkXoVqxYz=",
    usedBy: [
      { kind: "node", label: "node-1" },
      { kind: "node", label: "node-2" },
      { kind: "node", label: "node-3" },
    ],
    generated: "62d ago",
    lastUsed: "9m ago",
  },
  {
    id: "key_" + rid(),
    name: "mira-laptop",
    type: "ecdsa",
    fingerprint: "SHA256:Mr3SnKw8d2rUjAi5KgYh7uPb6dVtCmZ2GxYjWnRpyXa=",
    usedBy: [{ kind: "git", label: "GitHub" }],
    generated: "201d ago",
    lastUsed: "4h ago",
    imported: true,
  },
  {
    id: "key_" + rid(),
    name: "arjun-laptop",
    type: "rsa",
    bits: 4096,
    fingerprint: "SHA256:Ks4TpLx7f1qVjBg6JhZi8tNc5cWuDmA1FzXjVoSpzWb=",
    usedBy: [
      { kind: "git", label: "GitLab" },
      { kind: "service", label: "deploy-bot" },
    ],
    generated: "412d ago",
    lastUsed: "1d ago",
    imported: true,
    warn: "RSA — consider rotating to ed25519",
  },
];

export function SshKeys() {
  const [keys] = useState<SshKey[]>(INITIAL);
  const [genOpen, setGenOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="row" style={{ marginBottom: 16 }}>
          <SectionH
            title="SSH keys"
            sub="Used to authenticate Git pulls and to manage swarm nodes."
          />
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => setImportOpen(true)}>
            <I.upload width={11} height={11} /> Import
          </button>
          <div style={{ width: 8 }} />
          <button className="btn primary" onClick={() => setGenOpen(true)}>
            <I.plus width={12} height={12} /> Generate
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: 14,
          }}
        >
          {keys.map((k) => (
            <KeyCard key={k.id} k={k} />
          ))}
        </div>

        <div className="muted" style={{ fontSize: 11, marginTop: 14, lineHeight: 1.6 }}>
          Private keys are stored in the cluster KMS · only the public half is
          ever displayed in the UI.
        </div>
      </div>

      {genOpen && <GenerateModal onClose={() => setGenOpen(false)} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} />}
    </div>
  );
}

function KeyCard({ k }: { k: SshKey }) {
  const [copied, setCopied] = useState(false);
  const truncated = useMemo(() => {
    if (k.fingerprint.length <= 28) return k.fingerprint;
    return k.fingerprint.slice(0, 14) + "…" + k.fingerprint.slice(-10);
  }, [k.fingerprint]);

  const copy = () => {
    navigator.clipboard?.writeText(k.fingerprint).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="row gap-3" style={{ alignItems: "flex-start" }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            display: "grid",
            placeItems: "center",
            background: "var(--bg-sunken)",
            border: "1px solid var(--border)",
            color: "var(--fg-2)",
            flexShrink: 0,
          }}
        >
          <I.key width={16} height={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row gap-2" style={{ alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{k.name}</span>
            <span
              className="badge mono"
              style={{ background: "var(--bg-overlay)", color: "var(--fg-2)" }}
            >
              {k.type}
              {k.bits ? `-${k.bits}` : ""}
            </span>
            {k.imported && (
              <span
                className="badge"
                style={{ color: "var(--fg-3)" }}
              >
                imported
              </span>
            )}
            {k.warn && (
              <span className="badge warn">
                <span className="dot" />
                {k.warn}
              </span>
            )}
          </div>
          <div className="row gap-2" style={{ alignItems: "center", marginTop: 6 }}>
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--fg-3)",
                background: "var(--bg-sunken)",
                padding: "2px 6px",
                borderRadius: 3,
              }}
            >
              {truncated}
            </span>
            <button className="btn ghost icon sm" onClick={copy} title="Copy fingerprint">
              <I.copy width={11} height={11} />
            </button>
            {copied && (
              <span className="muted" style={{ fontSize: 11 }}>
                copied
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div
          className="muted"
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginBottom: 6,
          }}
        >
          Used by
        </div>
        <div className="row gap-1" style={{ flexWrap: "wrap" }}>
          {k.usedBy.map((u, i) => (
            <UsedByChip key={i} u={u} />
          ))}
          {k.usedBy.length === 0 && (
            <span className="muted" style={{ fontSize: 11 }}>
              not in use
            </span>
          )}
        </div>
      </div>

      <div
        className="row gap-2"
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
          alignItems: "center",
        }}
      >
        <span className="mono muted" style={{ fontSize: 11 }}>
          generated {k.generated}
          {k.lastUsed && ` · last used ${k.lastUsed}`}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn sm">
          <I.eye width={11} height={11} /> Reveal public key
        </button>
        <button className="btn sm ghost">
          <I.refresh width={11} height={11} /> Rotate
        </button>
        <button className="btn sm ghost" style={{ color: "var(--err)" }}>
          <I.trash width={11} height={11} />
        </button>
      </div>
    </div>
  );
}

function UsedByChip({ u }: { u: UsedBy }) {
  const Icon = u.kind === "git" ? I.branch : u.kind === "node" ? I.server : I.service;
  return (
    <span
      className="row gap-1"
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 999,
        border: "1px solid var(--border)",
        background: "var(--bg-overlay)",
        alignItems: "center",
      }}
    >
      <Icon width={10} height={10} style={{ color: "var(--fg-3)" }} />
      <span className="mono">{u.label}</span>
    </span>
  );
}

function GenerateModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<KeyType>("ed25519");
  const [passphrase, setPassphrase] = useState("");
  const [comment, setComment] = useState("");
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const pubkey = useMemo(() => {
    const algo =
      type === "ed25519"
        ? "ssh-ed25519"
        : type === "rsa"
          ? "ssh-rsa"
          : "ecdsa-sha2-nistp256";
    const body =
      "AAAAC3NzaC1lZDI1NTE5AAAAIBz8KqW9p7n0xRjVfL3tGc6eUpBnY2HsZkXoVrxYqM" +
      rid().toUpperCase();
    const tag = comment || `${name || "otterstack"}@otterstack`;
    return `${algo} ${body} ${tag}`;
  }, [type, name, comment]);

  const copy = () => {
    navigator.clipboard?.writeText(pubkey).catch(() => {});
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
          <I.key width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Generate SSH key</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div
          className="col gap-3"
          style={{ padding: 18, overflow: "auto", maxHeight: "65vh" }}
        >
          <Field label="Name">
            <input
              className="input mono"
              placeholder="otterstack-prod"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Key type
            </div>
            <div className="col gap-1">
              {(
                [
                  ["ed25519", "ed25519", "Recommended · small, fast, modern"],
                  ["ecdsa", "ecdsa", "NIST curves · widely supported"],
                  ["rsa", "rsa-4096", "Legacy · maximum compatibility"],
                ] as Array<[KeyType, string, string]>
              ).map(([k, label, sub]) => (
                <label
                  key={k}
                  className="row gap-2"
                  style={{
                    padding: 10,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: type === k ? "var(--bg-overlay)" : "transparent",
                    alignItems: "flex-start",
                  }}
                >
                  <input
                    type="radio"
                    name="keytype"
                    checked={type === k}
                    onChange={() => setType(k)}
                    style={{ marginTop: 2 }}
                  />
                  <div>
                    <div className="mono" style={{ fontSize: 12, fontWeight: 500 }}>
                      {label}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {sub}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <Field label="Passphrase (optional)">
            <input
              className="input mono"
              type="password"
              placeholder="leave empty for unattended use"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </Field>

          <Field label="Comment">
            <input
              className="input mono"
              placeholder="otterstack@helio"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>

          {generated && (
            <div>
              <div
                className="muted"
                style={{
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 6,
                }}
              >
                Public key
              </div>
              <div
                className="card"
                style={{ padding: 10, background: "var(--bg-sunken)" }}
              >
                <div
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "var(--fg-2)",
                    lineHeight: 1.6,
                    wordBreak: "break-all",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {pubkey}
                </div>
              </div>
              <div className="row gap-2" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={copy}>
                  <I.copy width={11} height={11} /> {copied ? "Copied" : "Copy"}
                </button>
                <button className="btn sm ghost">
                  <I.link width={11} height={11} /> Add to GitHub
                </button>
                <div style={{ flex: 1 }} />
                <span className="badge ok">
                  <span className="dot" />
                  generated
                </span>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                The private key has been encrypted and stored. It will never be
                displayed.
              </div>
            </div>
          )}
        </div>

        <div
          className="row gap-2"
          style={{ padding: 14, borderTop: "1px solid var(--border)" }}
        >
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            {generated ? "Close" : "Cancel"}
          </button>
          {!generated && (
            <button
              className="btn primary"
              onClick={() => setGenerated(true)}
              disabled={!name}
            >
              Generate
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [pubkey, setPubkey] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const detected = useMemo<KeyType | null>(() => {
    const trimmed = pubkey.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("ssh-ed25519")) return "ed25519";
    if (trimmed.startsWith("ssh-rsa")) return "rsa";
    if (trimmed.startsWith("ecdsa-sha2-")) return "ecdsa";
    return null;
  }, [pubkey]);

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
          <I.upload width={14} height={14} />
          <span style={{ fontWeight: 600 }}>Import SSH key</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>

        <div
          className="col gap-3"
          style={{ padding: 18, overflow: "auto", maxHeight: "65vh" }}
        >
          <Field label="Name">
            <input
              className="input mono"
              placeholder="alice-laptop"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field label="Public key">
            <textarea
              className="input mono"
              rows={6}
              placeholder={"ssh-ed25519 AAAA…  alice@host"}
              value={pubkey}
              onChange={(e) => setPubkey(e.target.value)}
              style={{ resize: "vertical", fontSize: 11, lineHeight: 1.5 }}
            />
          </Field>

          <div className="row gap-2" style={{ alignItems: "center" }}>
            <span className="muted" style={{ fontSize: 11 }}>
              Detected type:
            </span>
            {detected ? (
              <span className="badge mono">
                <span className="dot" style={{ background: "var(--ok)" }} />
                {detected}
              </span>
            ) : pubkey.trim() ? (
              <span className="badge warn">
                <span className="dot" />
                unrecognised — paste the full public key line
              </span>
            ) : (
              <span className="muted" style={{ fontSize: 11 }}>
                paste a public key above
              </span>
            )}
          </div>
        </div>

        <div
          className="row gap-2"
          style={{ padding: 14, borderTop: "1px solid var(--border)" }}
        >
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={onClose}
            disabled={!name || !detected}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
