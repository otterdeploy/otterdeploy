// Step_Image — container registry, image path + tag, available tags, service name, update strategy.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 1143-1355.
import type { AnyFieldApi } from "@tanstack/react-form";
import { SvglLogo } from "@/shared/components/brand/svgl-logo";
import { I } from "./icons";
import { SectionH, Field, SettingRow } from "./form-primitives";

type ImageProps = {
  imageField: AnyFieldApi;
  tagField: AnyFieldApi;
  registryField: AnyFieldApi;
  nameField: AnyFieldApi;
};

const registries = [
  { id: "docker", name: "Docker Hub", host: "docker.io", auth: "public" },
  {
    id: "ghcr",
    name: "GitHub Container Registry",
    host: "ghcr.io",
    auth: "paperhouse · pat",
  },
  {
    id: "ecr",
    name: "AWS ECR",
    host: "847395.dkr.ecr.us-west-2.amazonaws.com",
    auth: "iam role",
  },
  {
    id: "gcr",
    name: "Google Artifact Registry",
    host: "us-docker.pkg.dev",
    auth: "service account",
  },
  {
    id: "private",
    name: "Private registry",
    host: "registry.helio.so",
    auth: "basic",
  },
];

const availableTags = [
  { tag: "latest", size: "142 MB", pushed: "2h ago", sha: "a3f8b2c" },
  { tag: "v2.4.1", size: "142 MB", pushed: "2h ago", sha: "a3f8b2c" },
  { tag: "v2.4.0", size: "141 MB", pushed: "1d ago", sha: "8b1e9d4" },
  { tag: "v2.3.0", size: "139 MB", pushed: "1w ago", sha: "c2a5f01" },
  { tag: "main", size: "143 MB", pushed: "12m ago", sha: "f7c3a91" },
];

const registryBrandSearch = (id: string): string | null =>
  id === "docker"
    ? "Docker"
    : id === "ghcr"
      ? "GitHub"
      : id === "ecr"
        ? "AWS"
        : id === "gcr"
          ? "Google Cloud"
          : null;

export function StepImage({
  imageField,
  tagField,
  registryField,
  nameField,
}: ImageProps) {
  const image = imageField.state.value as string;
  const tag = tagField.state.value as string;
  const registry = registryField.state.value as string;

  const resolvedHost = registries.find((r) => r.id === registry)?.host ?? "";

  return (
    <>
      <SectionH title="Container registry" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginTop: 12,
        }}
      >
        {registries.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => registryField.handleChange(r.id)}
            className={`os-builder ${registry === r.id ? "active" : ""}`}
          >
            <div className="flex items-center gap-2">
              {registryBrandSearch(r.id) ? (
                <SvglLogo
                  search={registryBrandSearch(r.id)!}
                  fallback={r.name}
                  size={16}
                  background="transparent"
                  border="0"
                  color="currentColor"
                  style={{ borderRadius: 0 }}
                />
              ) : (
                <I.service width={13} height={13} />
              )}
              <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
            </div>
            <div
              className="text-muted-foreground font-mono"
              style={{ fontSize: 11, marginTop: 4 }}
            >
              {r.host}
            </div>
            <div style={{ marginTop: 6 }}>
              <span
                className="inline-flex items-center gap-1 font-mono"
                style={{
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 4,
                  border: "1px solid var(--border)",
                  background: "var(--muted)",
                  color: "var(--muted-foreground)",
                }}
              >
                <I.lock width={9} height={9} />
                {r.auth}
              </span>
            </div>
          </button>
        ))}
      </div>

      <div style={{ height: 22 }} />
      <SectionH title="Image" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div
          style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}
        >
          <Field label="Image">
            <input
              className="input font-mono"
              value={image}
              onChange={(e) => imageField.handleChange(e.target.value)}
            />
          </Field>
          <Field label="Tag">
            <input
              className="input font-mono"
              value={tag}
              onChange={(e) => tagField.handleChange(e.target.value)}
            />
          </Field>
        </div>
        <div style={{ height: 8 }} />
        <div
          className="text-muted-foreground font-mono"
          style={{ fontSize: 11 }}
        >
          resolved →{" "}
          <span style={{ color: "var(--foreground)" }}>
            {resolvedHost}/{image}:{tag}
          </span>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH
        title="Available tags"
        sub="Recently pushed to this repository"
      />
      <div className="card" style={{ marginTop: 10, overflow: "hidden" }}>
        {availableTags.map((t, i) => (
          <button
            key={t.tag}
            type="button"
            onClick={() => tagField.handleChange(t.tag)}
            className="flex items-center gap-3"
            style={{
              width: "100%",
              padding: "10px 14px",
              borderTop: "none",
              borderLeft: "none",
              borderRight: "none",
              borderBottom:
                i === availableTags.length - 1
                  ? "none"
                  : "1px solid var(--border)",
              background: tag === t.tag ? "var(--accent)" : "transparent",
              textAlign: "left",
              cursor: "pointer",
              color: "var(--foreground)",
            }}
          >
            <I.doc width={12} height={12} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
            <span
              className="font-mono"
              style={{ fontSize: 13, fontWeight: 500, flex: 1 }}
            >
              {t.tag}
            </span>
            <span className="text-muted-foreground font-mono" style={{ fontSize: 11 }}>
              {t.sha}
            </span>
            <span className="text-muted-foreground" style={{ fontSize: 11 }}>
              {t.size}
            </span>
            <span
              className="text-muted-foreground"
              style={{ fontSize: 11, width: 80, textAlign: "right" }}
            >
              {t.pushed}
            </span>
            {tag === t.tag && <I.check width={11} height={11} />}
          </button>
        ))}
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Service name" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <Field label="Name">
          <input
            className="input font-mono"
            value={nameField.state.value as string}
            onChange={(e) => nameField.handleChange(e.target.value)}
          />
        </Field>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Update strategy" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <SettingRow
          label="Watch tag for changes"
          defaultOn
          sub={`Pull and redeploy when :${tag} digest changes`}
        />
        <SettingRow
          label="Verify image signature (cosign)"
          sub="Reject pulls that fail signature verification"
        />
        <SettingRow
          label="Allow tag mutation"
          sub={`Re-pull on every deploy even if :${tag} digest is identical`}
        />
      </div>
    </>
  );
}
