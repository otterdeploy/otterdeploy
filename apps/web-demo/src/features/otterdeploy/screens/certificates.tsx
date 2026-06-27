// Certificates — TLS certs served from the Caddy edge proxy.
// Tabs: Managed (auto-renewed via ACME) · Custom (uploaded PEM) · CAs.

import { useMemo, useState } from "react";

import { Field, SectionH } from "../components/form";
import { I } from "../icons";

type CertStatus = "active" | "renewing" | "failed";
type KeyAlg = "ECDSA P-256" | "ECDSA P-384" | "RSA 2048" | "RSA 4096";

interface ManagedCert {
  id: string;
  hostname: string;
  issuer: string;
  serial: string;
  san: string[];
  expiresInDays: number;
  keyAlg: KeyAlg;
  status: CertStatus;
}

interface CustomCert {
  id: string;
  hostname: string;
  issuer: string;
  serial: string;
  san: string[];
  expiresInDays: number;
  keyAlg: KeyAlg;
  uploadedBy: string;
  uploadedAt: string;
}

interface CA {
  id: string;
  name: string;
  subject: string;
  fingerprint: string;
  expiresInDays: number;
  trustedBy: number;
}

const MANAGED: ManagedCert[] = [
  {
    id: "cert_helio",
    hostname: "helio.so",
    issuer: "Let's Encrypt R3",
    serial: "04:5a:bc:1f:88:9d:ee:ff:01:23:45:67:89:ab:cd:ef",
    san: ["helio.so"],
    expiresInDays: 87,
    keyAlg: "ECDSA P-256",
    status: "active",
  },
  {
    id: "cert_www",
    hostname: "www.helio.so",
    issuer: "Let's Encrypt R3",
    serial: "04:5a:bc:1f:88:9d:ee:ff:11:23:45:67:89:ab:cd:f0",
    san: ["www.helio.so"],
    expiresInDays: 87,
    keyAlg: "ECDSA P-256",
    status: "active",
  },
  {
    id: "cert_api",
    hostname: "api.helio.so",
    issuer: "Let's Encrypt R3",
    serial: "04:5a:bc:1f:88:9d:ee:ff:21:23:45:67:89:ab:cd:f1",
    san: ["api.helio.so", "api-eu.helio.so"],
    expiresInDays: 87,
    keyAlg: "ECDSA P-256",
    status: "active",
  },
  {
    id: "cert_img",
    hostname: "img.helio.so",
    issuer: "Let's Encrypt R3",
    serial: "04:5a:bc:1f:88:9d:ee:ff:31:23:45:67:89:ab:cd:f2",
    san: ["img.helio.so", "cdn.helio.so"],
    expiresInDays: 12,
    keyAlg: "ECDSA P-256",
    status: "renewing",
  },
  {
    id: "cert_staging",
    hostname: "staging.helio.so",
    issuer: "Let's Encrypt R3",
    serial: "04:5a:bc:1f:88:9d:ee:ff:41:23:45:67:89:ab:cd:f3",
    san: ["staging.helio.so", "*.staging.helio.so"],
    expiresInDays: 54,
    keyAlg: "ECDSA P-256",
    status: "active",
  },
  {
    id: "cert_internal",
    hostname: "*.helio.internal",
    issuer: "otterdeploy-mTLS-CA",
    serial: "08:11:22:33:44:55:66:77:88:99:aa:bb:cc:dd:ee:ff",
    san: ["*.helio.internal"],
    expiresInDays: 365,
    keyAlg: "ECDSA P-384",
    status: "active",
  },
];

const CUSTOM: CustomCert[] = [
  {
    id: "cert_partner",
    hostname: "partner.helio.so",
    issuer: "DigiCert TLS RSA SHA256 2020 CA1",
    serial: "0a:11:cf:ee:e7:23:45:bb:7c:1a:2d:3e:4f:50:61:72",
    san: ["partner.helio.so"],
    expiresInDays: 198,
    keyAlg: "RSA 2048",
    uploadedBy: "mira",
    uploadedAt: "12d ago",
  },
  {
    id: "cert_legacy",
    hostname: "legacy.helio.com",
    issuer: "Sectigo RSA Domain Validation",
    serial: "12:99:ab:cd:ef:00:11:22:33:44:55:66:77:88:99:aa",
    san: ["legacy.helio.com"],
    expiresInDays: 24,
    keyAlg: "RSA 4096",
    uploadedBy: "arjun",
    uploadedAt: "85d ago",
  },
];

const CAS: CA[] = [
  {
    id: "ca_le",
    name: "Let's Encrypt ISRG Root X1",
    subject: "CN=ISRG Root X1, O=Internet Security Research Group, C=US",
    fingerprint: "96:bc:ec:06:26:49:76:f3:74:60:77:8c:8d:a1:7c:5b",
    expiresInDays: 4072,
    trustedBy: 5,
  },
  {
    id: "ca_internal",
    name: "otterdeploy-mTLS-CA",
    subject: "CN=otterdeploy-mTLS-CA, O=paperhouse",
    fingerprint: "ab:cd:ef:01:23:45:67:89:00:11:22:33:44:55:66:77",
    expiresInDays: 1820,
    trustedBy: 1,
  },
  {
    id: "ca_zerossl",
    name: "ZeroSSL ECC Domain Secure Site CA",
    subject: "CN=ZeroSSL ECC Domain Secure Site CA, O=ZeroSSL, C=AT",
    fingerprint: "d4:78:a4:18:4b:cc:dd:11:34:7c:e3:90:8a:b3:62:8a",
    expiresInDays: 2840,
    trustedBy: 0,
  },
];

type Tab = "managed" | "custom" | "cas";

export function Certificates() {
  const [tab, setTab] = useState<Tab>("managed");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [caUploadOpen, setCaUploadOpen] = useState(false);
  const [pemViewOpen, setPemViewOpen] = useState<CA | null>(null);

  const stats = useMemo(() => {
    const total = MANAGED.length + CUSTOM.length;
    const autoRenew = MANAGED.length;
    const expiring =
      MANAGED.filter((c) => c.expiresInDays < 30).length +
      CUSTOM.filter((c) => c.expiresInDays < 30).length;
    const uploaded = CUSTOM.length;
    return { total, autoRenew, expiring, uploaded };
  }, []);

  const tabs: Array<[Tab, string, (typeof I)[keyof typeof I]]> = [
    ["managed", "Managed", I.lock],
    ["custom", "Custom", I.upload],
    ["cas", "CAs", I.key],
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="os-scroll" style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div className="row" style={{ marginBottom: 16 }}>
            <SectionH
              title="Certificates"
              sub="TLS certificates served from the Caddy edge proxy."
            />
            <div style={{ flex: 1 }} />
            <button className="btn">
              <I.refresh width={12} height={12} /> Renew all
            </button>
            <button className="btn primary" onClick={() => setUploadOpen(true)}>
              <I.upload width={12} height={12} /> Upload custom
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <Stat
              label="Total certs"
              value={`${stats.total}`}
              sub={`${MANAGED.length} managed · ${CUSTOM.length} custom`}
            />
            <Stat
              label="Auto-renewed"
              value={`${stats.autoRenew}`}
              sub="via ACME (Let's Encrypt)"
            />
            <Stat
              label="Expiring < 30d"
              value={`${stats.expiring}`}
              sub="renewal scheduled"
              tone={stats.expiring > 0 ? "warn" : undefined}
            />
            <Stat
              label="Upload-managed"
              value={`${stats.uploaded}`}
              sub="manual rotation required"
            />
          </div>

          <div
            className="row gap-1"
            style={{
              background: "var(--bg-sunken)",
              padding: 3,
              borderRadius: 6,
              border: "1px solid var(--border)",
              display: "inline-flex",
              marginBottom: 16,
            }}
          >
            {tabs.map(([id, label, Ic]) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className="row gap-2"
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    borderRadius: 4,
                    background: active ? "var(--bg-elev)" : "transparent",
                    color: active ? "var(--fg)" : "var(--fg-3)",
                    fontWeight: active ? 500 : 400,
                    cursor: "pointer",
                    boxShadow: active ? "var(--shadow-sm)" : "none",
                    border: 0,
                    alignItems: "center",
                  }}
                >
                  <Ic width={12} height={12} style={{ opacity: 0.8 }} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>

          {tab === "managed" && <ManagedTable />}
          {tab === "custom" && <CustomTable onUpload={() => setUploadOpen(true)} />}
          {tab === "cas" && (
            <CAsTable onUpload={() => setCaUploadOpen(true)} onView={(ca) => setPemViewOpen(ca)} />
          )}
        </div>
      </div>

      {uploadOpen && <UploadCertModal onClose={() => setUploadOpen(false)} />}
      {caUploadOpen && <UploadCAModal onClose={() => setCaUploadOpen(false)} />}
      {pemViewOpen && <ViewPEMModal ca={pemViewOpen} onClose={() => setPemViewOpen(null)} />}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "warn" | "err" | "ok";
}) {
  const color =
    tone === "warn"
      ? "var(--warn)"
      : tone === "err"
        ? "var(--err)"
        : tone === "ok"
          ? "var(--ok)"
          : "var(--fg)";
  return (
    <div className="card" style={{ padding: 14 }}>
      <div
        className="muted"
        style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", marginTop: 4, color }}>
        {value}
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}

function ExpiresCell({ days }: { days: number }) {
  const warn = days < 30;
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const iso = date.toISOString().slice(0, 10);
  return (
    <span className="col" style={{ alignItems: "flex-start", gap: 2, lineHeight: 1.2 }}>
      <span className="mono" style={{ fontSize: 11, color: warn ? "var(--warn)" : "var(--fg-2)" }}>
        {iso}
      </span>
      <span className="muted" style={{ fontSize: 10 }}>
        in {days}d
      </span>
    </span>
  );
}

function CertStatusBadge({ status }: { status: CertStatus }) {
  if (status === "active")
    return (
      <span className="badge ok">
        <span className="dot" />
        active
      </span>
    );
  if (status === "renewing")
    return (
      <span className="badge info">
        <span className="dot" />
        renewing
      </span>
    );
  return (
    <span className="badge err">
      <span className="dot" />
      failed
    </span>
  );
}

function SANChips({ list }: { list: string[] }) {
  return (
    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {list.map((s) => (
        <span
          key={s}
          className="mono"
          style={{
            fontSize: 10,
            padding: "1px 5px",
            borderRadius: 3,
            background: "var(--bg-overlay)",
            color: "var(--fg-3)",
          }}
        >
          {s}
        </span>
      ))}
    </span>
  );
}

function truncSerial(s: string) {
  if (s.length <= 23) return s;
  return s.slice(0, 11) + "…" + s.slice(-8);
}

function ManagedTable() {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div className="os-pe-head" style={{ padding: "10px 14px" }}>
        <span style={{ flex: 1.2 }}>Hostname</span>
        <span style={{ width: 130 }}>Issuer</span>
        <span style={{ width: 170 }}>Serial</span>
        <span style={{ flex: 1.4 }}>SAN</span>
        <span style={{ width: 120 }}>Expires</span>
        <span style={{ width: 110 }}>Key</span>
        <span style={{ width: 100 }}>Status</span>
        <span style={{ width: 200, textAlign: "right" }}>Actions</span>
      </div>
      {MANAGED.map((c, i) => (
        <div
          key={c.id}
          className="row"
          style={{
            padding: "12px 14px",
            borderTop: i > 0 ? "1px solid var(--border)" : "none",
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1.2, display: "flex", alignItems: "center", gap: 8 }}>
            <I.lock width={12} height={12} style={{ color: "var(--fg-3)" }} />
            <span className="mono" style={{ fontWeight: 500 }}>
              {c.hostname}
            </span>
          </span>
          <span style={{ width: 130, color: "var(--fg-2)", fontSize: 11 }}>{c.issuer}</span>
          <span className="mono muted" style={{ width: 170, fontSize: 10 }}>
            {truncSerial(c.serial)}
          </span>
          <span style={{ flex: 1.4 }}>
            <SANChips list={c.san} />
          </span>
          <span style={{ width: 120 }}>
            <ExpiresCell days={c.expiresInDays} />
          </span>
          <span style={{ width: 110 }}>
            <span
              className="badge mono"
              style={{ background: "var(--bg-overlay)", fontSize: 10, color: "var(--fg-2)" }}
            >
              {c.keyAlg}
            </span>
          </span>
          <span style={{ width: 100 }}>
            <CertStatusBadge status={c.status} />
          </span>
          <span style={{ width: 200, textAlign: "right" }}>
            <span className="row gap-1" style={{ justifyContent: "flex-end" }}>
              <button className="btn sm">
                <I.refresh width={10} height={10} /> Renew
              </button>
              <button className="btn sm">
                <I.log width={10} height={10} /> Logs
              </button>
              <button className="btn ghost icon sm" title="Revoke">
                <I.trash width={11} height={11} />
              </button>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function CustomTable({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div
        className="row"
        style={{
          padding: "10px 14px",
          background: "var(--bg-sunken)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span className="muted" style={{ fontSize: 11 }}>
          Uploaded PEM bundles · no auto-renew · operator-rotated
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn sm primary" onClick={onUpload}>
          <I.upload width={10} height={10} /> Paste PEM
        </button>
      </div>
      <div className="os-pe-head" style={{ padding: "10px 14px" }}>
        <span style={{ flex: 1.2 }}>Hostname</span>
        <span style={{ width: 200 }}>Issuer</span>
        <span style={{ width: 170 }}>Serial</span>
        <span style={{ flex: 1 }}>SAN</span>
        <span style={{ width: 120 }}>Expires</span>
        <span style={{ width: 110 }}>Key</span>
        <span style={{ width: 130 }}>Uploaded</span>
        <span style={{ width: 130, textAlign: "right" }}>Actions</span>
      </div>
      {CUSTOM.map((c, i) => (
        <div
          key={c.id}
          className="row"
          style={{
            padding: "12px 14px",
            borderTop: i > 0 ? "1px solid var(--border)" : "none",
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1.2, display: "flex", alignItems: "center", gap: 8 }}>
            <I.lock width={12} height={12} style={{ color: "var(--fg-3)" }} />
            <span className="mono" style={{ fontWeight: 500 }}>
              {c.hostname}
            </span>
          </span>
          <span style={{ width: 200, color: "var(--fg-2)", fontSize: 11 }}>{c.issuer}</span>
          <span className="mono muted" style={{ width: 170, fontSize: 10 }}>
            {truncSerial(c.serial)}
          </span>
          <span style={{ flex: 1 }}>
            <SANChips list={c.san} />
          </span>
          <span style={{ width: 120 }}>
            <ExpiresCell days={c.expiresInDays} />
          </span>
          <span style={{ width: 110 }}>
            <span
              className="badge mono"
              style={{ background: "var(--bg-overlay)", fontSize: 10, color: "var(--fg-2)" }}
            >
              {c.keyAlg}
            </span>
          </span>
          <span className="muted" style={{ width: 130, fontSize: 11 }}>
            {c.uploadedAt} ·{" "}
            <span className="mono" style={{ color: "var(--fg-3)" }}>
              {c.uploadedBy}
            </span>
          </span>
          <span style={{ width: 130, textAlign: "right" }}>
            <span className="row gap-1" style={{ justifyContent: "flex-end" }}>
              <button className="btn sm">
                <I.upload width={10} height={10} /> Replace
              </button>
              <button className="btn ghost icon sm" title="Delete">
                <I.trash width={11} height={11} />
              </button>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function CAsTable({ onUpload, onView }: { onUpload: () => void; onView: (ca: CA) => void }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div
        className="row"
        style={{
          padding: "10px 14px",
          background: "var(--bg-sunken)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span className="muted" style={{ fontSize: 11 }}>
          Trusted certificate authorities · used to validate upstream + mTLS chains
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn sm primary" onClick={onUpload}>
          <I.upload width={10} height={10} /> Upload CA
        </button>
      </div>
      <div className="os-pe-head" style={{ padding: "10px 14px" }}>
        <span style={{ flex: 1.4 }}>Name</span>
        <span style={{ flex: 1.6 }}>Subject</span>
        <span style={{ width: 220 }}>Fingerprint (SHA-1)</span>
        <span style={{ width: 130 }}>Expires</span>
        <span style={{ width: 100 }}>Trusted by</span>
        <span style={{ width: 150, textAlign: "right" }}>Actions</span>
      </div>
      {CAS.map((ca, i) => (
        <div
          key={ca.id}
          className="row"
          style={{
            padding: "12px 14px",
            borderTop: i > 0 ? "1px solid var(--border)" : "none",
            fontSize: 12,
          }}
        >
          <span style={{ flex: 1.4, display: "flex", alignItems: "center", gap: 8 }}>
            <I.key width={12} height={12} style={{ color: "var(--fg-3)" }} />
            <span style={{ fontWeight: 500 }}>{ca.name}</span>
          </span>
          <span className="mono muted" style={{ flex: 1.6, fontSize: 10 }}>
            {ca.subject}
          </span>
          <span className="mono muted" style={{ width: 220, fontSize: 10 }}>
            {ca.fingerprint}
          </span>
          <span style={{ width: 130 }}>
            <ExpiresCell days={ca.expiresInDays} />
          </span>
          <span className="mono" style={{ width: 100, color: "var(--fg-2)" }}>
            {ca.trustedBy} chains
          </span>
          <span style={{ width: 150, textAlign: "right" }}>
            <span className="row gap-1" style={{ justifyContent: "flex-end" }}>
              <button className="btn sm" onClick={() => onView(ca)}>
                <I.eye width={10} height={10} /> View PEM
              </button>
              <button className="btn ghost icon sm" title="Remove">
                <I.trash width={11} height={11} />
              </button>
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function ModalShell({
  title,
  icon: Ic,
  width = 600,
  onClose,
  children,
  footer,
}: {
  title: string;
  icon: (typeof I)[keyof typeof I];
  width?: number;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
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
      <div onClick={(e) => e.stopPropagation()} className="os-modal" style={{ width }}>
        <div className="row os-modal-h gap-2">
          <Ic width={14} height={14} />
          <span style={{ fontWeight: 600 }}>{title}</span>
          <div style={{ flex: 1 }} />
          <button className="btn ghost icon sm" onClick={onClose}>
            <I.close width={13} height={13} />
          </button>
        </div>
        <div className="col gap-3" style={{ padding: 18, overflow: "auto", maxHeight: "70vh" }}>
          {children}
        </div>
        <div className="row gap-2" style={{ padding: 14, borderTop: "1px solid var(--border)" }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

function UploadCertModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell
      title="Upload custom certificate"
      icon={I.upload}
      width={620}
      onClose={onClose}
      footer={
        <>
          <span className="muted" style={{ fontSize: 11 }}>
            Otterdeploy validates chain + key pair before applying
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={onClose}>
            Upload
          </button>
        </>
      }
    >
      <Field label="Hostname (CN)">
        <input className="input mono" placeholder="legacy.helio.com" />
      </Field>
      <Field label="Certificate chain (PEM)">
        <textarea
          className="input mono"
          rows={6}
          placeholder={`-----BEGIN CERTIFICATE-----\nMIIDxTCCAq2gAwIBAgIQ...\n-----END CERTIFICATE-----`}
        />
      </Field>
      <Field label="Private key (PEM)">
        <textarea
          className="input mono"
          rows={5}
          placeholder={`-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEF...\n-----END PRIVATE KEY-----`}
        />
      </Field>
      <div className="muted" style={{ fontSize: 11 }}>
        Custom certificates are not auto-renewed. You will receive a warning notification 30 days
        before expiry.
      </div>
    </ModalShell>
  );
}

function UploadCAModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell
      title="Upload trusted CA"
      icon={I.key}
      width={580}
      onClose={onClose}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={onClose}>
            Add CA
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" placeholder="internal-issuing-ca" />
      </Field>
      <Field label="CA certificate (PEM)">
        <textarea
          className="input mono"
          rows={8}
          placeholder={`-----BEGIN CERTIFICATE-----\nMIIFazCCA1OgAwIBAgIRAIIQ...\n-----END CERTIFICATE-----`}
        />
      </Field>
    </ModalShell>
  );
}

function ViewPEMModal({ ca, onClose }: { ca: CA; onClose: () => void }) {
  const fakePem = [
    "-----BEGIN CERTIFICATE-----",
    "MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw",
    "TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh",
    "cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4",
    "WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu",
    "ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY",
    "MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc",
    "h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+",
    "0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U",
    "(snip)",
    "-----END CERTIFICATE-----",
  ].join("\n");

  return (
    <ModalShell
      title={`View PEM · ${ca.name}`}
      icon={I.eye}
      width={680}
      onClose={onClose}
      footer={
        <>
          <button className="btn">
            <I.copy width={11} height={11} /> Copy
          </button>
          <button className="btn">
            <I.download width={11} height={11} /> Download
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="row gap-3" style={{ fontSize: 11, color: "var(--fg-3)", flexWrap: "wrap" }}>
        <span>
          subject{" "}
          <span className="mono" style={{ color: "var(--fg-2)" }}>
            {ca.subject}
          </span>
        </span>
        <span>
          fingerprint{" "}
          <span className="mono" style={{ color: "var(--fg-2)" }}>
            {ca.fingerprint}
          </span>
        </span>
      </div>
      <div
        className="card mono"
        style={{
          padding: 12,
          background: "var(--bg-sunken)",
          fontSize: 11,
          lineHeight: 1.6,
          whiteSpace: "pre",
          overflow: "auto",
          color: "var(--fg-2)",
        }}
      >
        {fakePem}
      </div>
    </ModalShell>
  );
}
