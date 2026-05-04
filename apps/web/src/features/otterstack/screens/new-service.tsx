// New service creation — comprehensive multi-step flow.
// Service kind picker → source → builder/image → networking → resources → review.
//
// The flow ADAPTS to the chosen kind:
//   - apps/workers/static → source + builder + scaling + networking
//   - databases (postgres/mysql/redis/etc) → version + resources + storage + backups (no builder, no public route)
//   - templates → multi-service preview, edit per-service knobs
//   - docker image → registry/tag picker
//   - compose → file upload + parse preview

import type { CSSProperties, ReactNode } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";

import { DatabaseLogo } from "@/components/brand/database-logo";
import { SvglLogo } from "@/components/brand/svgl-logo";
import { I, type IconKey } from "../icons";
import {
  BUILDERS,
  NODES,
  REGIONS,
  RESOURCE_PRESETS,
  SERVICE_KINDS,
  TEMPLATES,
  type ServiceKindDef,
  type Template,
} from "../data";
import {
  Field,
  Switch3,
  SettingRow,
  SectionH,
  BuilderConfig,
} from "../components/form";
import type { Tab } from "../app";

type Step =
  | "kind"
  | "source"
  | "builder"
  | "image"
  | "compose"
  | "version"
  | "networking"
  | "resources"
  | "storage"
  | "variables"
  | "advanced"
  | "review";

type KindTab = "compute" | "data" | "template" | "custom";

type LaunchPreset = {
  kindId?: string | null;
  kindTab?: KindTab;
  step?: Step;
};

type Port = { port: number; protocol: string; public: boolean; host: string };

type LinkedSecrets = Record<string, boolean>;

const iconKey = (raw: string): IconKey => ((raw as IconKey) in I ? (raw as IconKey) : "doc");
const sourceBrandSearch = (id: string) =>
  id === "github" ? "GitHub" : id === "gitlab" ? "GitLab" : id === "gitea" ? "Gitea" : null;
const registryBrandSearch = (id: string) =>
  id === "docker"
    ? "Docker"
    : id === "ghcr"
      ? "GitHub"
      : id === "ecr"
        ? "AWS"
        : id === "gcr"
          ? "Google Cloud"
          : null;

export function NewService({
  onTab,
  initialSelection,
}: {
  onTab: (t: Tab | string) => void;
  initialSelection?: LaunchPreset;
}) {
  // Top-level state
  const [kindId, setKindId] = useState<string | null>(initialSelection?.kindId ?? null);
  const [step, setStep] = useState<Step>(initialSelection?.step ?? "kind");

  const kind = SERVICE_KINDS.find((k) => k.id === kindId) ?? null;
  const isApp = !!kind && ["app", "worker", "cron", "static", "function"].includes(kind.id);
  const isDb = !!kind && kind.group === "data";

  // Build the step list dynamically based on kind
  const steps = useMemo<Array<[Step, string, string]>>(() => {
    if (!kind) return [["kind", "Service type", "service"]];
    if (isDb)
      return [
        ["kind", "Service type", "service"],
        ["version", "Version", "doc"],
        ["resources", "Resources", "scale"],
        ["storage", "Storage & backups", "folder"],
        ["advanced", "Advanced", "settings"],
        ["review", "Review", "check"],
      ];
    if (kind.id === "compose")
      return [
        ["kind", "Service type", "service"],
        ["compose", "Compose file", "doc"],
        ["variables", "Variables", "env"],
        ["review", "Review", "check"],
      ];
    if (kind.id === "docker")
      return [
        ["kind", "Service type", "service"],
        ["image", "Image", "doc"],
        ["networking", "Networking", "globe"],
        ["resources", "Resources", "scale"],
        ["variables", "Variables", "env"],
        ["review", "Review", "check"],
      ];
    return [
      ["kind", "Service type", "service"],
      ["source", "Source", "branch"],
      ["builder", "Builder", "bolt"],
      ["networking", "Networking", "globe"],
      ["resources", "Resources", "scale"],
      ["variables", "Variables", "env"],
      ["review", "Review", "check"],
    ];
  }, [kind, isDb]);

  const idx = steps.findIndex((s) => s[0] === step);
  const isLast = idx === steps.length - 1;
  const goNext = () => idx < steps.length - 1 && setStep(steps[idx + 1][0]);
  const goPrev = () => idx > 0 && setStep(steps[idx - 1][0]);

  // ───── Form state ─────
  const [src, setSrc] = useState("github");
  const [repo, setRepo] = useState("paperhouse/helio");
  const [branch, setBranch] = useState("main");
  const [root, setRoot] = useState("apps/notify");
  const [name, setName] = useState("notify");
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [previewBranches, setPreviewBranches] = useState(true);

  const [builderId, setBuilderId] = useState("railpack");

  const [image, setImage] = useState("ghcr.io/paperhouse/notify");
  const [tag, setTag] = useState("latest");
  const [registry, setRegistry] = useState("ghcr");

  const [version, setVersion] = useState<string | null>(null);

  const [ports, setPorts] = useState<Port[]>([
    { port: 3000, protocol: "http", public: true, host: "notify.helio.so" },
  ]);
  const [healthPath, setHealthPath] = useState("/health");
  const [healthInterval, setHealthInterval] = useState("10s");

  const [presetId, setPresetId] = useState("small");
  const [customCpu, setCustomCpu] = useState(0.5);
  const [customMem, setCustomMem] = useState(512);
  const [replicas, setReplicas] = useState(1);
  const [region, setRegion] = useState("sfo");
  const [placement, setPlacement] = useState("any");

  const [storageGb, setStorageGb] = useState(20);
  const [backupsEnabled, setBackupsEnabled] = useState(true);
  const [backupRetention, setBackupRetention] = useState(7);
  const [pitr, setPitr] = useState(false);
  const [highAvailability, setHighAvailability] = useState(false);

  const [envText, setEnvText] = useState("");
  const [linkedSecrets, setLinkedSecrets] = useState<LinkedSecrets>({ infisical: true });

  useEffect(() => {
    if (!initialSelection) return;
    setKindId(initialSelection.kindId ?? null);
    setStep(initialSelection.step ?? "kind");
  }, [initialSelection]);

  // sensible default name when kind changes
  useEffect(() => {
    if (!kind) return;
    if (isDb) setName(kind.id);
    if (kind.id === "docker") setName("custom");
    if (kind.versions && !version) setVersion(kind.versions[0]);
    // Touch unused to keep TS happy with isApp narrowing intent
    void isApp;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindId]);

  // Validation per step
  const canAdvance =
    step === "kind"
      ? !!kindId
      : step === "source"
        ? !!repo && !!name
        : step === "image"
          ? !!image && !!tag && !!name
          : step === "version"
            ? !!version
            : true;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="row" style={{ padding: "14px 22px", borderBottom: "1px solid var(--border)" }}>
        <button className="btn ghost icon sm" onClick={() => onTab("graph")}>
          <I.chev width={11} height={11} style={{ transform: "rotate(180deg)" }} />
        </button>
        <span style={{ fontWeight: 600, fontSize: 15, marginLeft: 8 }}>Create new service</span>
        {kind && (
          <span className="muted mono" style={{ marginLeft: 10, fontSize: 11 }}>
            · {kind.name}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11 }}>
          Step {idx + 1} of {steps.length}
        </span>
      </div>

      <Stepper steps={steps} idx={idx} setStep={setStep} />

      <div style={{ flex: 1, overflow: "auto", padding: 22 }} className="os-scroll">
        <div style={{ maxWidth: step === "kind" ? 1100 : 820, margin: "0 auto" }}>
          {step === "kind" && (
            <Step_Kind
              kindId={kindId}
              setKindId={setKindId}
              initialTab={initialSelection?.kindTab}
            />
          )}

          {step === "source" && (
            <Step_Source
              src={src}
              setSrc={setSrc}
              repo={repo}
              setRepo={setRepo}
              branch={branch}
              setBranch={setBranch}
              root={root}
              setRoot={setRoot}
              name={name}
              setName={setName}
              autoDeploy={autoDeploy}
              previewBranches={previewBranches}
            />
          )}

          {step === "builder" && (
            <Step_Builder builderId={builderId} setBuilderId={setBuilderId} name={name} />
          )}

          {step === "image" && (
            <Step_Image
              image={image}
              setImage={setImage}
              tag={tag}
              setTag={setTag}
              registry={registry}
              setRegistry={setRegistry}
              name={name}
              setName={setName}
            />
          )}

          {step === "compose" && <Step_Compose />}

          {step === "version" && kind && (
            <Step_Version
              kind={kind}
              version={version}
              setVersion={setVersion}
              name={name}
              setName={setName}
            />
          )}

          {step === "networking" && (
            <Step_Networking
              ports={ports}
              setPorts={setPorts}
              healthPath={healthPath}
              setHealthPath={setHealthPath}
              healthInterval={healthInterval}
              setHealthInterval={setHealthInterval}
              kind={kind}
            />
          )}

          {step === "resources" && (
            <Step_Resources
              presetId={presetId}
              setPresetId={setPresetId}
              customCpu={customCpu}
              setCustomCpu={setCustomCpu}
              customMem={customMem}
              setCustomMem={setCustomMem}
              replicas={replicas}
              setReplicas={setReplicas}
              region={region}
              setRegion={setRegion}
              placement={placement}
              setPlacement={setPlacement}
              isDb={isDb}
            />
          )}

          {step === "storage" && (
            <Step_Storage
              storageGb={storageGb}
              setStorageGb={setStorageGb}
              backupsEnabled={backupsEnabled}
              setBackupsEnabled={setBackupsEnabled}
              backupRetention={backupRetention}
              setBackupRetention={setBackupRetention}
              pitr={pitr}
              highAvailability={highAvailability}
              setHighAvailability={setHighAvailability}
              kind={kind}
            />
          )}

          {step === "variables" && (
            <Step_Variables
              envText={envText}
              setEnvText={setEnvText}
              linkedSecrets={linkedSecrets}
              setLinkedSecrets={setLinkedSecrets}
              kind={kind}
            />
          )}

          {step === "advanced" && <Step_AdvancedDb kind={kind} />}

          {step === "review" && (
            <Step_Review
              kind={kind}
              name={name}
              src={src}
              repo={repo}
              branch={branch}
              root={root}
              builderId={builderId}
              image={image}
              tag={tag}
              version={version}
              ports={ports}
              replicas={replicas}
              presetId={presetId}
              customCpu={customCpu}
              customMem={customMem}
              region={region}
              storageGb={storageGb}
              backupsEnabled={backupsEnabled}
              isDb={isDb}
            />
          )}
        </div>
      </div>

      <div
        className="row"
        style={{
          padding: 14,
          borderTop: "1px solid var(--border)",
          gap: 8,
          background: "var(--bg)",
        }}
      >
        <button className="btn" onClick={() => onTab("graph")}>
          Cancel
        </button>
        <div style={{ flex: 1 }} />
        {idx > 0 && (
          <button className="btn" onClick={goPrev}>
            ← Back
          </button>
        )}
        {!isLast && (
          <button
            className="btn primary"
            onClick={goNext}
            disabled={!canAdvance}
            style={{ opacity: canAdvance ? 1 : 0.5 }}
          >
            Continue →
          </button>
        )}
        {isLast && (
          <button className="btn primary" onClick={() => onTab("graph")}>
            <I.rocket width={11} height={11} /> Create & deploy
          </button>
        )}
      </div>

    </div>
  );
}

// ────── Stepper ──────
function Stepper({
  steps,
  idx,
  setStep,
}: {
  steps: Array<[Step, string, string]>;
  idx: number;
  setStep: (s: Step) => void;
}) {
  return (
    <div
      className="row"
      style={{
        padding: "14px 22px",
        gap: 0,
        background: "var(--bg-sunken)",
        borderBottom: "1px solid var(--border)",
        overflowX: "auto",
      }}
    >
      {steps.map(([id, lab], i) => {
        return (
          <Fragment key={id}>
            <button
              className="row gap-2"
              onClick={() => i <= idx && setStep(id)}
              style={{
                background: "transparent",
                border: 0,
                cursor: i <= idx ? "pointer" : "default",
                padding: "4px 10px",
                borderRadius: 5,
                flexShrink: 0,
                color:
                  i === idx ? "var(--fg)" : i < idx ? "var(--fg-2)" : "var(--fg-4)",
                fontWeight: i === idx ? 500 : 400,
                fontSize: 12,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: i <= idx ? "var(--fg)" : "var(--bg-elev)",
                  color: i <= idx ? "var(--bg)" : "var(--fg-3)",
                  border: i > idx ? "1px solid var(--border)" : "none",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                }}
              >
                {i < idx ? <I.check width={10} height={10} /> : i + 1}
              </span>
              <span>{lab}</span>
            </button>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: "var(--border)",
                  margin: "0 6px",
                  minWidth: 16,
                }}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function Step_Kind({
  kindId,
  setKindId,
  initialTab,
}: {
  kindId: string | null;
  setKindId: (id: string) => void;
  initialTab?: KindTab;
}) {
  const [tab, setTab] = useState<KindTab>(initialTab ?? "compute");

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  const groups: Record<KindTab, { label: string; sub: string }> = {
    compute: {
      label: "Compute",
      sub: "Code that runs your business logic — apps, workers, jobs, static sites",
    },
    data: { label: "Data", sub: "Stateful services — databases, caches, queues, search, storage" },
    template: { label: "Templates", sub: "Curated multi-service starters" },
    custom: { label: "Custom", sub: "Bring your own image or compose file" },
  };
  const tabs: Array<[KindTab, IconKey]> = [
    ["compute", "service"],
    ["data", "db"],
    ["template", "folder"],
    ["custom", "bolt"],
  ];

  const items: Array<ServiceKindDef | Template> =
    tab === "template" ? TEMPLATES : SERVICE_KINDS.filter((k) => k.group === tab);

  return (
    <>
      <SectionH
        title="What do you want to deploy?"
        sub="Pick a service type to get a tailored creation flow"
      />

      <div
        className="row"
        style={{ borderBottom: "1px solid var(--border)", marginTop: 10, gap: 0 }}
      >
        {tabs.map(([id, ic]) => {
          const Ic = I[ic];
          return (
            <button
              key={id}
              className="os-envtab"
              data-active={tab === id}
              onClick={() => setTab(id)}
              style={{ height: 36, borderRight: 0 }}
            >
              <Ic width={12} height={12} style={{ opacity: 0.7 }} /> <span>{groups[id].label}</span>
              <span className="os-envtab-underline" />
            </button>
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
        {groups[tab].sub}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginTop: 14,
        }}
      >
        {items.map((it) => {
          const Ic = I[iconKey(it.icon)];
          const active = kindId === it.id;
          const popular = "popular" in it ? !!it.popular : false;
          const examples = "examples" in it ? it.examples : undefined;
          const versions = "versions" in it ? it.versions : undefined;
          const services = "services" in it ? it.services : undefined;
          return (
            <button
              key={it.id}
              onClick={() => setKindId(it.id)}
              className={`os-builder ${active ? "active" : ""}`}
              style={{ textAlign: "left", padding: 14, minHeight: 96 }}
            >
              {popular && <span className="os-builder-pop">popular</span>}
              <div className="row gap-2">
                <div className="os-builder-icon">
                  {renderLauncherKindIcon(it, tab, Ic)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{it.name}</div>
                </div>
                {active && (
                  <I.check width={12} height={12} style={{ color: "var(--fg)" }} />
                )}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>
                {it.sub}
              </div>
              {examples && (
                <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 6 }}>
                  {examples}
                </div>
              )}
              {versions && (
                <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 6 }}>
                  versions: {versions.slice(0, 3).join(", ")}
                </div>
              )}
              {services !== undefined && (
                <div className="mono" style={{ fontSize: 10, color: "var(--fg-4)", marginTop: 6 }}>
                  {services} services included
                </div>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function renderLauncherKindIcon(
  item: ServiceKindDef | Template,
  tab: KindTab,
  Icon: (props: { width?: number; height?: number; style?: CSSProperties }) => ReactNode,
) {
  if (tab !== "data") return <Icon width={14} height={14} />;

  const id = item.id.toLowerCase();
  const supportsBrandLogo =
    id === "postgres" ||
    id === "mysql" ||
    id === "mariadb" ||
    id === "redis" ||
    id === "mongodb" ||
    id === "clickhouse";

  if (supportsBrandLogo) {
    return <DatabaseLogo value={`${item.id} ${item.name}`} size={14} color="var(--fg-2)" />;
  }

  return <Icon width={14} height={14} />;
}

// ────── Step: Source (repo) ──────
function Step_Source({
  src,
  setSrc,
  repo,
  setRepo,
  branch,
  setBranch,
  root,
  setRoot,
  name,
  setName,
  autoDeploy,
  previewBranches,
}: {
  src: string;
  setSrc: (s: string) => void;
  repo: string;
  setRepo: (s: string) => void;
  branch: string;
  setBranch: (s: string) => void;
  root: string;
  setRoot: (s: string) => void;
  name: string;
  setName: (s: string) => void;
  autoDeploy: boolean;
  previewBranches: boolean;
}) {
  const sources = [
    { id: "github", name: "GitHub", sub: "Push-to-deploy · webhooks installed", icon: "branch" },
    { id: "gitlab", name: "GitLab", sub: "Self-hosted or SaaS", icon: "branch" },
    { id: "gitea", name: "Gitea / Forgejo", sub: "Any self-hosted Git provider", icon: "branch" },
    { id: "pubgit", name: "Public Git URL", sub: "Read-only · manual deploy from URL", icon: "link" },
    { id: "cli", name: "Push from CLI", sub: "otterstack push from local", icon: "doc" },
  ];

  const recent = [
    { repo: "paperhouse/helio", stars: 142, lang: "TypeScript", updated: "2h ago" },
    { repo: "paperhouse/notify", stars: 23, lang: "Go", updated: "1d ago" },
    { repo: "paperhouse/admin", stars: 8, lang: "TypeScript", updated: "3d ago" },
    { repo: "paperhouse/scheduler", stars: 4, lang: "Python", updated: "1w ago" },
  ];

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
              onClick={() => setSrc(s.id)}
              className={`os-builder ${src === s.id ? "active" : ""}`}
            >
              <div className="row gap-2">
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
              <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
                {s.sub}
              </div>
            </button>
          );
        })}
      </div>

      {src === "github" && (
        <>
          <div style={{ height: 22 }} />
          <SectionH title="Repository" />
          <div className="card" style={{ padding: 0, marginTop: 10, overflow: "hidden" }}>
            <div
              className="row gap-2"
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                background: "var(--bg-sunken)",
              }}
            >
              <I.search width={12} height={12} style={{ color: "var(--fg-3)" }} />
              <input
                className="input mono"
                placeholder="search repositories…"
                defaultValue={repo}
                onChange={(e) => setRepo(e.target.value)}
                style={{
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  fontSize: 13,
                  flex: 1,
                }}
              />
              <span className="badge">
                <I.lock width={9} height={9} />
                paperhouse · github app
              </span>
            </div>
            <div style={{ maxHeight: 220, overflow: "auto" }}>
              {recent.map((r) => (
                <button
                  key={r.repo}
                  onClick={() => setRepo(r.repo)}
                  className="row gap-3"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: repo === r.repo ? "var(--bg-overlay)" : "transparent",
                    border: 0,
                    borderBottom: "1px solid var(--border)",
                    textAlign: "left",
                    cursor: "pointer",
                    color: "var(--fg)",
                  }}
                >
                  <I.branch width={12} height={12} style={{ color: "var(--fg-3)" }} />
                  <span className="mono" style={{ fontSize: 13, flex: 1 }}>
                    {r.repo}
                  </span>
                  <span className="badge">{r.lang}</span>
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    ★ {r.stars} · {r.updated}
                  </span>
                  {repo === r.repo && <I.check width={11} height={11} />}
                </button>
              ))}
            </div>
          </div>

          <div style={{ height: 18 }} />
          <SectionH title="Configuration" />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Branch">
                <select
                  className="input mono"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  <option>main</option>
                  <option>develop</option>
                  <option>staging</option>
                </select>
              </Field>
              <Field label="Root directory">
                <input
                  className="input mono"
                  value={root}
                  onChange={(e) => setRoot(e.target.value)}
                />
              </Field>
            </div>
            <div style={{ height: 12 }} />
            <Field label="Service name">
              <input
                className="input mono"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Used in DNS —{" "}
                <span className="mono" style={{ color: "var(--fg-2)" }}>
                  {name}.helio.internal
                </span>
              </div>
            </Field>
            <div style={{ height: 14 }} />
            <SettingRow
              label="Auto-deploy on push"
              sub={`Trigger a deploy whenever ${branch} updates`}
              defaultOn={autoDeploy}
            />
            <SettingRow
              label="Preview deploys for pull requests"
              sub="Spin up a temporary environment for every PR"
              defaultOn={previewBranches}
            />
            <SettingRow
              label="Deploy only when watched paths change"
              sub={`Skip rebuilds unless files in ${root}/ are modified`}
              defaultOn
            />
          </div>
        </>
      )}

      {src === "pubgit" && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <Field label="Public Git URL">
            <input className="input mono" placeholder="https://github.com/owner/repo.git" />
          </Field>
          <div style={{ height: 10 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Branch / tag / commit">
              <input className="input mono" defaultValue="main" />
            </Field>
            <Field label="Service name">
              <input
                className="input mono"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          </div>
        </div>
      )}

      {src === "cli" && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Push from your terminal — no Git provider required.
          </div>
          <pre
            className="mono"
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
              className="input mono"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>
      )}
    </>
  );
}

// ────── Step: Builder ──────
function Step_Builder({
  builderId,
  setBuilderId,
  name,
}: {
  builderId: string;
  setBuilderId: (id: string) => void;
  name: string;
}) {
  const detected = {
    lang: "Node 20",
    file: "package.json",
    framework: "Next.js 15",
    detector: "railpack",
  };

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
        <div className="row gap-2">
          <I.check width={14} height={14} style={{ color: "var(--info)" }} />
          <div style={{ flex: 1, fontSize: 13 }}>
            <div style={{ color: "var(--info)", fontWeight: 500 }}>
              Detected: {detected.framework}
            </div>
            <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
              {detected.lang} · {detected.file} · resolved by {detected.detector}
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
              onClick={() => setBuilderId(b.id)}
              className={`os-builder ${builderId === b.id ? "active" : ""}`}
            >
              {b.popular && <span className="os-builder-pop">popular</span>}
              <div className="row gap-2">
                <div className="os-builder-icon">
                  <Ic width={14} height={14} />
                </div>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</span>
                {builderId === b.id && (
                  <I.check
                    width={12}
                    height={12}
                    style={{ marginLeft: "auto", color: "var(--fg)" }}
                  />
                )}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
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

// ────── Step: Image (custom Docker) ──────
function Step_Image({
  image,
  setImage,
  tag,
  setTag,
  registry,
  setRegistry,
  name,
  setName,
}: {
  image: string;
  setImage: (s: string) => void;
  tag: string;
  setTag: (s: string) => void;
  registry: string;
  setRegistry: (s: string) => void;
  name: string;
  setName: (s: string) => void;
}) {
  const registries = [
    { id: "docker", name: "Docker Hub", host: "docker.io", auth: "public" },
    { id: "ghcr", name: "GitHub Container Registry", host: "ghcr.io", auth: "paperhouse · pat" },
    { id: "ecr", name: "AWS ECR", host: "847395.dkr.ecr.us-west-2.amazonaws.com", auth: "iam role" },
    { id: "gcr", name: "Google Artifact Registry", host: "us-docker.pkg.dev", auth: "service account" },
    { id: "private", name: "Private registry", host: "registry.helio.so", auth: "basic" },
  ];

  const tags = [
    { tag: "latest", size: "142 MB", pushed: "2h ago", sha: "a3f8b2c" },
    { tag: "v2.4.1", size: "142 MB", pushed: "2h ago", sha: "a3f8b2c" },
    { tag: "v2.4.0", size: "141 MB", pushed: "1d ago", sha: "8b1e9d4" },
    { tag: "v2.3.0", size: "139 MB", pushed: "1w ago", sha: "c2a5f01" },
    { tag: "main", size: "143 MB", pushed: "12m ago", sha: "f7c3a91" },
  ];

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
            onClick={() => setRegistry(r.id)}
            className={`os-builder ${registry === r.id ? "active" : ""}`}
          >
            <div className="row gap-2" style={{ alignItems: "center" }}>
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
            <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
              {r.host}
            </div>
            <div style={{ marginTop: 6 }}>
              <span className="badge">
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
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <Field label="Image">
            <input
              className="input mono"
              value={image}
              onChange={(e) => setImage(e.target.value)}
            />
          </Field>
          <Field label="Tag">
            <input
              className="input mono"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </Field>
        </div>
        <div style={{ height: 8 }} />
        <div className="muted mono" style={{ fontSize: 11 }}>
          resolved →{" "}
          <span style={{ color: "var(--fg-2)" }}>
            {registries.find((r) => r.id === registry)?.host}/{image}:{tag}
          </span>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Available tags" sub="Recently pushed to this repository" />
      <div className="card" style={{ marginTop: 10, overflow: "hidden" }}>
        {tags.map((t, i) => (
          <button
            key={t.tag}
            onClick={() => setTag(t.tag)}
            className="row gap-3"
            style={{
              width: "100%",
              padding: "10px 14px",
              borderBottom: i === tags.length - 1 ? "none" : "1px solid var(--border)",
              background: tag === t.tag ? "var(--bg-overlay)" : "transparent",
              border: 0,
              textAlign: "left",
              cursor: "pointer",
              color: "var(--fg)",
            }}
          >
            <I.doc width={12} height={12} style={{ color: "var(--fg-3)" }} />
            <span className="mono" style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>
              {t.tag}
            </span>
            <span className="muted mono" style={{ fontSize: 11 }}>
              {t.sha}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              {t.size}
            </span>
            <span className="muted" style={{ fontSize: 11, width: 80, textAlign: "right" }}>
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
            className="input mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
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

// ────── Step: Compose ──────
function Step_Compose() {
  const sample = `services:
  app:
    image: ghcr.io/paperhouse/notify:latest
    ports: ["3000:3000"]
    depends_on: [postgres, redis]
    environment:
      DATABASE_URL: \${DATABASE_URL}

  postgres:
    image: postgres:16
    volumes: ["postgres-data:/var/lib/postgresql/data"]
    environment:
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD}

  redis:
    image: redis:7-alpine

volumes:
  postgres-data:`;

  return (
    <>
      <SectionH
        title="Compose file"
        sub="We'll parse this into individual Otterstack services"
      />
      <div className="card" style={{ padding: 0, marginTop: 12, overflow: "hidden" }}>
        <div
          className="row gap-2"
          style={{
            padding: "10px 14px",
            background: "var(--bg-sunken)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <I.doc width={12} height={12} style={{ color: "var(--fg-3)" }} />
          <span className="mono" style={{ fontSize: 12, flex: 1 }}>
            compose.yml
          </span>
          <button className="btn sm">
            <I.upload width={11} height={11} /> Upload
          </button>
          <button className="btn sm">Paste from clipboard</button>
        </div>
        <textarea
          className="mono"
          defaultValue={sample}
          style={{
            width: "100%",
            minHeight: 320,
            padding: 14,
            border: 0,
            fontSize: 12,
            lineHeight: 1.6,
            background: "var(--bg-sunken)",
            color: "var(--fg-2)",
            resize: "vertical",
            outline: "none",
          }}
        />
      </div>

      <div style={{ height: 18 }} />
      <SectionH
        title="Detected services"
        sub="3 services will be created · network and volumes auto-wired"
      />
      <div className="card" style={{ marginTop: 10, overflow: "hidden" }}>
        {[
          { name: "app", image: "ghcr.io/paperhouse/notify:latest", port: 3000, kind: "app" },
          { name: "postgres", image: "postgres:16", port: 5432, kind: "postgres" },
          { name: "redis", image: "redis:7-alpine", port: 6379, kind: "redis" },
        ].map((s, i) => (
          <div
            key={s.name}
            className="row gap-2"
            style={{
              padding: "12px 14px",
              borderBottom: i === 2 ? "none" : "1px solid var(--border)",
            }}
          >
            <span style={{ width: 24, color: "var(--fg-3)" }}>
              {s.kind === "app" ? (
                <I.service width={13} height={13} />
              ) : (
                <DatabaseLogo value={`${s.name} ${s.image}`} size={13} color="var(--fg-3)" />
              )}
            </span>
            <div style={{ flex: 1 }}>
              <span className="mono" style={{ fontWeight: 500, fontSize: 13 }}>
                {s.name}
              </span>
              <span className="muted mono" style={{ fontSize: 11, marginLeft: 8 }}>
                {s.image}
              </span>
            </div>
            <span className="badge mono">:{s.port}</span>
            <span className="badge ok">
              <span className="dot" />
              valid
            </span>
          </div>
        ))}
      </div>

      <div style={{ height: 14 }} />
      <div
        className="card"
        style={{ padding: 12, background: "var(--info-bg)", borderColor: "var(--info)" }}
      >
        <div className="row gap-2" style={{ alignItems: "flex-start" }}>
          <I.check
            width={14}
            height={14}
            style={{ color: "var(--info)", flexShrink: 0, marginTop: 2 }}
          />
          <div style={{ fontSize: 12, color: "var(--info)" }}>
            All <span className="mono">${"{VAR}"}</span> references will be promoted to
            project-level variables. You'll set values in the next step.
          </div>
        </div>
      </div>
    </>
  );
}

// ────── Step: Version (databases) ──────
function Step_Version({
  kind,
  version,
  setVersion,
  name,
  setName,
}: {
  kind: ServiceKindDef;
  version: string | null;
  setVersion: (v: string) => void;
  name: string;
  setName: (s: string) => void;
}) {
  const port =
    kind.id === "postgres"
      ? 5432
      : kind.id === "mysql"
        ? 3306
        : kind.id === "redis"
          ? 6379
          : kind.id === "mongodb"
            ? 27017
            : kind.id === "clickhouse"
              ? 9000
              : "auto";
  return (
    <>
      <SectionH
        title={`${kind.name} version`}
        sub="Pick a major version — minor versions are auto-upgraded during maintenance windows"
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 10,
          marginTop: 12,
        }}
      >
        {(kind.versions || []).map((v, i) => (
          <button
            key={v}
            onClick={() => setVersion(v)}
            className={`os-builder ${version === v ? "active" : ""}`}
          >
            {i === 0 && <span className="os-builder-pop">latest</span>}
            <div className="row gap-2">
              <div className="os-builder-icon">
                <DatabaseLogo value={kind.id} size={14} />
              </div>
              <span style={{ fontWeight: 600, fontSize: 14 }} className="mono">
                {kind.id} {v}
              </span>
              {version === v && (
                <I.check
                  width={12}
                  height={12}
                  style={{ marginLeft: "auto", color: "var(--fg)" }}
                />
              )}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
              {i === 0
                ? "Newest stable release · all features available"
                : i === 1
                  ? "Long-term support · stable for production"
                  : "Older release · only choose for legacy compatibility"}
            </div>
          </button>
        ))}
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Database name" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <Field label="Service name">
          <input
            className="input mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Reachable at{" "}
            <span className="mono" style={{ color: "var(--fg-2)" }}>
              {name}.helio.internal:{port}
            </span>
          </div>
        </Field>
      </div>
    </>
  );
}

// ────── Step: Networking ──────
function Step_Networking({
  ports,
  setPorts,
  healthPath,
  setHealthPath,
  healthInterval,
  setHealthInterval,
  kind,
}: {
  ports: Port[];
  setPorts: (fn: (ps: Port[]) => Port[]) => void;
  healthPath: string;
  setHealthPath: (s: string) => void;
  healthInterval: string;
  setHealthInterval: (s: string) => void;
  kind: ServiceKindDef | null;
}) {
  const isWorker = kind?.id === "worker";
  const isCron = kind?.id === "cron";
  const isStatic = kind?.id === "static";

  if (isCron) {
    return (
      <>
        <SectionH title="Schedule" sub="When should this job run?" />
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <Field label="Cron expression">
            <input className="input mono" defaultValue="0 3 * * *" />
            <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>
              Every day at 03:00 UTC · next run in 7h 12m
            </div>
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Timezone">
            <select className="input">
              <option>UTC</option>
              <option>America/Los_Angeles</option>
              <option>Europe/London</option>
            </select>
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Command">
            <input className="input mono" defaultValue="node scripts/cleanup.js" />
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Max runtime">
            <input className="input mono" defaultValue="30m" />
          </Field>
        </div>
        <div style={{ height: 14 }} />
        <div className="card" style={{ padding: 16 }}>
          <SettingRow
            label="Skip if previous run still active"
            sub="Don't pile up overlapping invocations"
            defaultOn
          />
          <SettingRow label="Alert on failure" defaultOn sub="Send to #ops Slack channel" />
        </div>
      </>
    );
  }

  if (isWorker) {
    return (
      <>
        <SectionH
          title="Workers don't expose ports"
          sub="No HTTP listener — this service runs a long process"
        />
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <Field label="Process command">
            <input className="input mono" defaultValue="celery -A app worker --loglevel=info" />
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Graceful shutdown timeout">
            <input className="input mono" defaultValue="30s" />
          </Field>
          <div style={{ height: 10 }} />
          <Field label="Liveness probe">
            <input
              className="input mono"
              placeholder="optional · exec command, e.g. celery inspect ping"
            />
          </Field>
        </div>
      </>
    );
  }

  return (
    <>
      <SectionH title="Ports" sub="Which container ports should be exposed?" />
      <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
        <div
          className="row"
          style={{
            padding: "10px 14px",
            background: "var(--bg-sunken)",
            borderBottom: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--fg-3)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
          }}
        >
          <span style={{ width: 80 }}>Port</span>
          <span style={{ width: 100 }}>Protocol</span>
          <span style={{ flex: 1 }}>Public hostname</span>
          <span style={{ width: 70 }}>Public</span>
          <span style={{ width: 50 }} />
        </div>
        {ports.map((p, i) => (
          <div
            key={i}
            className="row"
            style={{
              padding: "10px 14px",
              borderBottom: i === ports.length - 1 ? "none" : "1px solid var(--border)",
            }}
          >
            <span style={{ width: 80 }}>
              <input
                className="input mono"
                type="number"
                value={p.port}
                onChange={(e) =>
                  setPorts((ps) =>
                    ps.map((x, j) => (j === i ? { ...x, port: +e.target.value } : x)),
                  )
                }
                style={{ width: 70 }}
              />
            </span>
            <span style={{ width: 100 }}>
              <select
                className="input mono"
                value={p.protocol}
                onChange={(e) =>
                  setPorts((ps) =>
                    ps.map((x, j) => (j === i ? { ...x, protocol: e.target.value } : x)),
                  )
                }
                style={{ width: 90 }}
              >
                <option value="http">HTTP</option>
                <option value="http2">HTTP/2</option>
                <option value="grpc">gRPC</option>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </span>
            <span style={{ flex: 1, paddingRight: 10 }}>
              <input
                className="input mono"
                value={p.host}
                onChange={(e) =>
                  setPorts((ps) =>
                    ps.map((x, j) => (j === i ? { ...x, host: e.target.value } : x)),
                  )
                }
                disabled={!p.public}
                style={{ width: "100%", opacity: p.public ? 1 : 0.5 }}
              />
            </span>
            <span style={{ width: 70 }}>
              <Switch3
                on={p.public}
                onChange={(v) =>
                  setPorts((ps) => ps.map((x, j) => (j === i ? { ...x, public: v } : x)))
                }
              />
            </span>
            <span style={{ width: 50, textAlign: "right" }}>
              <button
                className="btn ghost icon sm"
                onClick={() => setPorts((ps) => ps.filter((_, j) => j !== i))}
              >
                <I.x width={11} height={11} />
              </button>
            </span>
          </div>
        ))}
        <div style={{ padding: "10px 14px" }}>
          <button
            className="btn sm"
            onClick={() =>
              setPorts((ps) => [
                ...ps,
                { port: 8080, protocol: "http", public: false, host: "" },
              ])
            }
          >
            <I.plus width={11} height={11} /> Add port
          </button>
        </div>
      </div>

      {!isStatic && (
        <>
          <div style={{ height: 18 }} />
          <SectionH
            title="Health check"
            sub="How does Otterstack know your service is ready to serve traffic?"
          />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
              <Field label="Path">
                <input
                  className="input mono"
                  value={healthPath}
                  onChange={(e) => setHealthPath(e.target.value)}
                />
              </Field>
              <Field label="Interval">
                <input
                  className="input mono"
                  value={healthInterval}
                  onChange={(e) => setHealthInterval(e.target.value)}
                />
              </Field>
              <Field label="Timeout">
                <input className="input mono" defaultValue="3s" />
              </Field>
            </div>
            <div style={{ height: 10 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Successes before ready">
                <input className="input mono" type="number" defaultValue={2} />
              </Field>
              <Field label="Failures before unhealthy">
                <input className="input mono" type="number" defaultValue={3} />
              </Field>
            </div>
          </div>
        </>
      )}

      <div style={{ height: 18 }} />
      <SectionH title="Edge proxy" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <SettingRow
          label="Auto-issue TLS certificates"
          sub="Let's Encrypt · auto-renewed before expiry"
          defaultOn
        />
        <SettingRow label="HTTP → HTTPS redirect" defaultOn sub="Force secure connections" />
        <SettingRow label="HTTP/3 (QUIC)" defaultOn sub="Serve over QUIC where available" />
        <SettingRow label="Compression (zstd, gzip)" defaultOn sub="Encode responses on the wire" />
        <SettingRow label="WebSocket upgrade" defaultOn sub="Allow ws:// connection upgrades" />
        <SettingRow
          label="Forward X-Forwarded-For"
          defaultOn
          sub="Pass real client IP through to upstream"
        />
      </div>
    </>
  );
}

// ────── Step: Resources ──────
function Step_Resources({
  presetId,
  setPresetId,
  customCpu,
  setCustomCpu,
  customMem,
  setCustomMem,
  replicas,
  setReplicas,
  region,
  setRegion,
  placement,
  setPlacement,
  isDb,
}: {
  presetId: string;
  setPresetId: (id: string) => void;
  customCpu: number;
  setCustomCpu: (n: number) => void;
  customMem: number;
  setCustomMem: (n: number) => void;
  replicas: number;
  setReplicas: (fn: number | ((r: number) => number)) => void;
  region: string;
  setRegion: (r: string) => void;
  placement: string;
  setPlacement: (p: string) => void;
  isDb: boolean;
}) {
  const preset = RESOURCE_PRESETS.find((p) => p.id === presetId);
  const cpu = preset?.cpu ?? customCpu;
  const mem = preset?.mem ?? customMem;
  const totalCpu = (cpu * replicas).toFixed(2);
  const totalMem = ((mem * replicas) / 1024).toFixed(2);
  const totalCost = preset?.cost != null ? preset.cost * replicas : null;

  return (
    <>
      <SectionH title="Size" sub="How much CPU and memory does each replica get?" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginTop: 12,
        }}
      >
        {RESOURCE_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPresetId(p.id)}
            className={`os-builder ${presetId === p.id ? "active" : ""}`}
            style={{ minHeight: 96 }}
          >
            {p.popular && <span className="os-builder-pop">popular</span>}
            <div className="row gap-2">
              <span style={{ fontWeight: 600, fontSize: 14 }}>{p.name}</span>
              {presetId === p.id && (
                <I.check
                  width={12}
                  height={12}
                  style={{ marginLeft: "auto", color: "var(--fg)" }}
                />
              )}
            </div>
            <div className="mono" style={{ fontSize: 12, marginTop: 6, color: "var(--fg-2)" }}>
              {p.cpu != null && p.mem != null
                ? `${p.cpu} vCPU · ${p.mem >= 1024 ? p.mem / 1024 + " GB" : p.mem + " MB"}`
                : "configure manually"}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {p.sub}
            </div>
            {p.cost !== null && (
              <div
                className="mono"
                style={{ fontSize: 11, marginTop: 8, color: "var(--fg-3)" }}
              >
                ~${p.cost}/mo per replica
              </div>
            )}
          </button>
        ))}
      </div>

      {presetId === "custom" && (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <Field label={`CPU · ${customCpu} vCPU`}>
            <input
              type="range"
              min="0.1"
              max="8"
              step="0.1"
              value={customCpu}
              onChange={(e) => setCustomCpu(+e.target.value)}
              style={{ width: "100%" }}
            />
          </Field>
          <div style={{ height: 12 }} />
          <Field
            label={`Memory · ${customMem >= 1024 ? (customMem / 1024).toFixed(1) + " GB" : customMem + " MB"}`}
          >
            <input
              type="range"
              min="128"
              max="16384"
              step="128"
              value={customMem}
              onChange={(e) => setCustomMem(+e.target.value)}
              style={{ width: "100%" }}
            />
          </Field>
        </div>
      )}

      {!isDb && (
        <>
          <div style={{ height: 18 }} />
          <SectionH title="Replicas" sub="How many copies of this service to run?" />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            <div className="row gap-2">
              <button
                className="btn ghost icon"
                onClick={() => setReplicas((r: number) => Math.max(1, r - 1))}
              >
                <I.x width={11} height={11} />
              </button>
              <input
                className="input mono"
                type="number"
                value={replicas}
                onChange={(e) => setReplicas(+e.target.value || 1)}
                style={{ width: 70, textAlign: "center", fontSize: 16, height: 36 }}
              />
              <button
                className="btn ghost icon"
                onClick={() => setReplicas((r: number) => r + 1)}
              >
                <I.plus width={11} height={11} />
              </button>
              <div style={{ flex: 1 }} />
              <span className="muted mono" style={{ fontSize: 11 }}>
                scale up to {replicas * 5} via autoscaler
              </span>
            </div>
            <div style={{ height: 14 }} />
            <SettingRow
              label="Enable autoscaling"
              sub={`Scale between ${replicas} and ${replicas * 5} replicas based on CPU > 60%`}
            />
            <SettingRow
              label="Zero-downtime rolling deploy"
              defaultOn
              sub="Drain old replicas only after new ones report ready"
            />
          </div>
        </>
      )}

      <div style={{ height: 18 }} />
      <SectionH
        title="Placement"
        sub={`Where should this run? · ${NODES.length} nodes available in ${REGIONS.length} regions`}
      />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <Field label="Region">
          <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.flag} {r.name} · {r.nodes} node{r.nodes > 1 ? "s" : ""} · {r.latency}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ height: 12 }} />
        <Field label="Placement strategy">
          <select
            className="input"
            value={placement}
            onChange={(e) => setPlacement(e.target.value)}
          >
            <option value="any">Any node — let scheduler decide</option>
            <option value="spread">Spread across nodes — one replica per node</option>
            <option value="pack">Pack onto fewest nodes — minimize spread</option>
            <option value="pin">Pin to specific node</option>
          </select>
        </Field>

        {/* node placement preview */}
        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: "var(--bg-sunken)",
            borderRadius: 6,
            border: "1px solid var(--border)",
          }}
        >
          <div
            className="muted"
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 8,
            }}
          >
            predicted placement
          </div>
          <div className="row gap-2">
            {NODES.map((n, ni) => {
              const onThis =
                placement === "spread"
                  ? ni < replicas
                    ? 1
                    : 0
                  : placement === "pack"
                    ? ni === 0
                      ? replicas
                      : 0
                    : Math.ceil((replicas - ni) / NODES.length);
              return (
                <div
                  key={n.id}
                  style={{
                    flex: 1,
                    padding: 10,
                    background: "var(--bg-elev)",
                    borderRadius: 5,
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="row gap-2" style={{ fontSize: 11 }}>
                    <span className="mono" style={{ color: "var(--fg-3)" }}>
                      {n.name}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span className="muted">
                      {Math.round((n.cpu.used / n.cpu.total) * 100)}%
                    </span>
                  </div>
                  <div className="row gap-1" style={{ marginTop: 6, flexWrap: "wrap" }}>
                    {Array.from({ length: Math.max(0, onThis) }).map((_, i) => (
                      <span
                        key={i}
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: "var(--ok)",
                        }}
                      />
                    ))}
                    {onThis === 0 && (
                      <span className="muted" style={{ fontSize: 10 }}>
                        —
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ height: 14 }} />
      <div className="card" style={{ padding: 14, background: "var(--bg-sunken)" }}>
        <div className="row gap-3">
          <div>
            <div
              className="muted"
              style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              service total
            </div>
            <div className="mono" style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>
              {totalCpu} vCPU · {totalMem} GB
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {totalCost !== null && (
            <div style={{ textAlign: "right" }}>
              <div
                className="muted"
                style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
              >
                est. monthly cost
              </div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>
                ${totalCost}/mo
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ────── Step: Storage (databases) ──────
function Step_Storage({
  storageGb,
  setStorageGb,
  backupsEnabled,
  setBackupsEnabled,
  backupRetention,
  setBackupRetention,
  pitr,
  highAvailability,
  setHighAvailability,
  kind,
}: {
  storageGb: number;
  setStorageGb: (n: number) => void;
  backupsEnabled: boolean;
  setBackupsEnabled: (b: boolean) => void;
  backupRetention: number;
  setBackupRetention: (n: number) => void;
  pitr: boolean;
  highAvailability: boolean;
  setHighAvailability: (b: boolean) => void;
  kind: ServiceKindDef | null;
}) {
  const isPostgres = kind?.id === "postgres";
  const isMysql = kind?.id === "mysql";
  const supportsPitr = isPostgres || isMysql;

  return (
    <>
      <SectionH
        title="Persistent storage"
        sub="Volume mounted at the data directory · backed by SSD"
      />
      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <Field label={`Volume size · ${storageGb} GB`}>
          <input
            type="range"
            min="5"
            max="2000"
            step="5"
            value={storageGb}
            onChange={(e) => setStorageGb(+e.target.value)}
            style={{ width: "100%" }}
          />
          <div className="row gap-3" style={{ fontSize: 11, marginTop: 6 }}>
            <span className="muted">5 GB</span>
            <div style={{ flex: 1 }} />
            <span className="muted mono">~${(storageGb * 0.1).toFixed(2)}/mo</span>
            <span className="muted">2 TB</span>
          </div>
        </Field>
        <div style={{ height: 14 }} />
        <SettingRow
          label="Auto-grow volume"
          defaultOn
          sub="Add 10 GB when free space drops below 15%"
        />
        <SettingRow label="Encrypt at rest" defaultOn sub="LUKS · per-project KMS key" />
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="Backups" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div className="row gap-3">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Daily snapshots</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Snapshot taken at 03:00 UTC · stored in S3-compatible object storage
            </div>
          </div>
          <Switch3 on={backupsEnabled} onChange={setBackupsEnabled} />
        </div>
        {backupsEnabled && (
          <>
            <div style={{ height: 14 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label={`Retention · ${backupRetention} days`}>
                <input
                  type="range"
                  min="1"
                  max="90"
                  value={backupRetention}
                  onChange={(e) => setBackupRetention(+e.target.value)}
                  style={{ width: "100%" }}
                />
              </Field>
              <Field label="Backup window">
                <select className="input">
                  <option>03:00 – 04:00 UTC</option>
                  <option>11:00 – 12:00 UTC</option>
                  <option>17:00 – 18:00 UTC</option>
                </select>
              </Field>
            </div>
          </>
        )}
        {supportsPitr && (
          <>
            <div style={{ height: 12 }} />
            <SettingRow
              label="Point-in-time recovery (PITR)"
              defaultOn={pitr}
              sub="Continuous WAL archiving · restore to any point in the last 7 days"
            />
          </>
        )}
      </div>

      <div style={{ height: 18 }} />
      <SectionH title="High availability" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div className="row gap-3">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Standby replica</div>
            <div className="muted" style={{ fontSize: 12 }}>
              Sync replica on a different node · failover in &lt; 30s
            </div>
          </div>
          <Switch3 on={highAvailability} onChange={setHighAvailability} />
        </div>
      </div>
    </>
  );
}

// ────── Step: Variables ──────
function Step_Variables({
  envText,
  setEnvText,
  linkedSecrets,
  setLinkedSecrets,
  kind,
}: {
  envText: string;
  setEnvText: (s: string) => void;
  linkedSecrets: LinkedSecrets;
  setLinkedSecrets: (fn: (s: LinkedSecrets) => LinkedSecrets) => void;
  kind: ServiceKindDef | null;
}) {
  const suggested =
    !kind || kind.group !== "data"
      ? [
          { k: "NODE_ENV", v: "production", source: "auto" as const },
          { k: "PORT", v: "3000", source: "auto" as const },
          {
            k: "DATABASE_URL",
            v: "postgres://helio:•••@postgres.helio.internal:5432/helio",
            source: "linked" as const,
            from: "postgres",
          },
          {
            k: "REDIS_URL",
            v: "redis://cache.helio.internal:6379",
            source: "linked" as const,
            from: "cache",
          },
        ]
      : [];

  return (
    <>
      <SectionH title="Environment variables" sub="Define values to inject at runtime" />

      {suggested.length > 0 && (
        <div className="card" style={{ marginTop: 12, overflow: "hidden" }}>
          <div
            className="row"
            style={{
              padding: "10px 14px",
              background: "var(--bg-sunken)",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--fg-3)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            <span style={{ flex: 1 }}>Auto-injected</span>
            <span className="badge">
              <I.bolt width={9} height={9} />
              otterstack-managed
            </span>
          </div>
          {suggested.map((s, i) => (
            <div
              key={s.k}
              className="row"
              style={{
                padding: "10px 14px",
                borderBottom: i === suggested.length - 1 ? "none" : "1px solid var(--border)",
              }}
            >
              <span className="mono" style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>
                {s.k}
              </span>
              <span className="mono muted" style={{ flex: 2, fontSize: 12 }}>
                {s.v}
              </span>
              <span style={{ width: 100, textAlign: "right" }}>
                {s.source === "linked" ? (
                  <span className="badge">
                    <I.link width={9} height={9} />
                    linked · {s.from}
                  </span>
                ) : (
                  <span className="badge">auto</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ height: 18 }} />
      <SectionH
        title="Custom variables"
        sub="One per line · KEY=value · supports comments with #"
      />
      <div className="card" style={{ padding: 0, marginTop: 10, overflow: "hidden" }}>
        <div
          className="row gap-2"
          style={{
            padding: "10px 14px",
            background: "var(--bg-sunken)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <button className="btn sm">
            <I.upload width={11} height={11} /> Upload .env
          </button>
          <button className="btn sm">
            <I.copy width={11} height={11} /> Paste from clipboard
          </button>
          <div style={{ flex: 1 }} />
          <span className="muted mono" style={{ fontSize: 11 }}>
            0 keys
          </span>
        </div>
        <textarea
          className="mono"
          value={envText}
          onChange={(e) => setEnvText(e.target.value)}
          placeholder={
            "# app config\nLOG_LEVEL=info\nFEATURE_FLAGS=async_jobs,new_billing\n\n# api keys\nSTRIPE_SECRET_KEY=sk_live_..."
          }
          style={{
            width: "100%",
            minHeight: 160,
            padding: 14,
            border: 0,
            fontSize: 12,
            lineHeight: 1.6,
            background: "var(--bg-sunken)",
            color: "var(--fg-2)",
            resize: "vertical",
            outline: "none",
          }}
        />
      </div>

      <div style={{ height: 18 }} />
      <SectionH
        title="Linked secret managers"
        sub="Pull secrets from external managers — they sync continuously"
      />
      <div className="card" style={{ marginTop: 10, overflow: "hidden" }}>
        {[
          { id: "infisical", name: "Infisical", sub: "paperhouse · helio · /apps" },
          { id: "vault", name: "HashiCorp Vault", sub: "vault.paperhouse.dev · kv/helio" },
          { id: "aws-sm", name: "AWS Secrets Manager", sub: "us-west-2 · helio/*" },
        ].map((p, i) => (
          <div
            key={p.id}
            className="row gap-3"
            style={{
              padding: "12px 14px",
              borderBottom: i === 2 ? "none" : "1px solid var(--border)",
            }}
          >
            <div style={{ width: 26 }}>
              <I.lock width={13} height={13} style={{ color: "var(--fg-3)" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{p.name}</div>
              <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
                {p.sub}
              </div>
            </div>
            <Switch3
              on={!!linkedSecrets[p.id]}
              onChange={(v) => setLinkedSecrets((s) => ({ ...s, [p.id]: v }))}
            />
          </div>
        ))}
      </div>
    </>
  );
}

// ────── Step: Advanced (databases) ──────
function Step_AdvancedDb({ kind }: { kind: ServiceKindDef | null }) {
  if (!kind) return null;
  const isPg = kind.id === "postgres";
  const isRedis = kind.id === "redis";
  return (
    <>
      <SectionH title="Connection pooling" />
      <div className="card" style={{ padding: 16, marginTop: 12 }}>
        <SettingRow
          label={isPg ? "Enable PgBouncer" : "Enable connection pooler"}
          defaultOn
          sub="Front the database with a transaction-mode pooler"
        />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
          <Field label="Pool size">
            <input className="input mono" type="number" defaultValue={20} />
          </Field>
          <Field label="Max client connections">
            <input className="input mono" type="number" defaultValue={200} />
          </Field>
        </div>
      </div>

      {isPg && (
        <>
          <div style={{ height: 18 }} />
          <SectionH title="Extensions" sub="Enable extensions on the postgres instance" />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            {[
              "pgvector — vector similarity search",
              "pgcrypto — cryptographic functions",
              "postgis — geographic queries",
              "pg_stat_statements — query statistics",
              "uuid-ossp — UUID generation",
              "pg_partman — partition manager",
              "timescaledb — time-series",
            ].map((e, i) => (
              <SettingRow
                key={i}
                label={e.split(" — ")[0]}
                sub={e.split(" — ")[1]}
                defaultOn={i < 4}
              />
            ))}
          </div>
        </>
      )}

      {isRedis && (
        <>
          <div style={{ height: 18 }} />
          <SectionH title="Redis configuration" />
          <div className="card" style={{ padding: 16, marginTop: 10 }}>
            <Field label="Eviction policy">
              <select className="input">
                <option>allkeys-lru — evict least recently used</option>
                <option>volatile-lru — evict TTL'd keys least recently used</option>
                <option>noeviction — return errors when full</option>
              </select>
            </Field>
            <div style={{ height: 12 }} />
            <SettingRow
              label="Persistence (AOF)"
              defaultOn
              sub="Append-only file fsync every second"
            />
            <SettingRow label="RDB snapshots" defaultOn sub="Periodic point-in-time dumps" />
          </div>
        </>
      )}

      <div style={{ height: 18 }} />
      <SectionH title="Maintenance window" sub="When can Otterstack apply patches?" />
      <div className="card" style={{ padding: 16, marginTop: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="Day">
            <select className="input">
              <option>Sunday</option>
              <option>Saturday</option>
              <option>Monday</option>
            </select>
          </Field>
          <Field label="Window">
            <select className="input">
              <option>03:00 – 05:00 UTC</option>
              <option>09:00 – 11:00 UTC</option>
              <option>15:00 – 17:00 UTC</option>
            </select>
          </Field>
        </div>
      </div>
    </>
  );
}

// ────── Step: Review ──────
function Step_Review({
  kind,
  name,
  src,
  repo,
  branch,
  root,
  builderId,
  image,
  tag,
  version,
  ports,
  replicas,
  presetId,
  customCpu,
  customMem,
  region,
  storageGb,
  backupsEnabled,
  isDb,
}: {
  kind: ServiceKindDef | null;
  name: string;
  src: string;
  repo: string;
  branch: string;
  root: string;
  builderId: string;
  image: string;
  tag: string;
  version: string | null;
  ports: Port[];
  replicas: number;
  presetId: string;
  customCpu: number;
  customMem: number;
  region: string;
  storageGb: number;
  backupsEnabled: boolean;
  isDb: boolean;
}) {
  const preset = RESOURCE_PRESETS.find((p) => p.id === presetId);
  const cpu = preset?.cpu ?? customCpu;
  const mem = preset?.mem ?? customMem;
  const reg = REGIONS.find((r) => r.id === region);

  // Generate a compose snippet
  const generateCompose = () => {
    const memStr = mem >= 1024 ? `${mem / 1024}G` : `${mem}M`;
    if (isDb && kind) {
      return `services:
  ${name}:
    image: ${kind.id}:${version}
    deploy:
      replicas: 1
      resources:
        limits: { cpus: '${cpu}', memory: ${memStr} }
    volumes:
      - ${name}-data:/var/lib/${kind.id === "postgres" ? "postgresql/data" : kind.id}
    networks: [helio_internal]

volumes:
  ${name}-data:
    driver_opts: { size: '${storageGb}G' }`;
    }
    return `services:
  ${name}:
    image: ${builderId === "dockerfile" ? `registry.helio.so/${name}:latest` : image + ":" + tag}
    deploy:
      replicas: ${replicas}
      resources:
        limits: { cpus: '${cpu}', memory: ${memStr} }
      update_config:
        order: start-first
        failure_action: rollback
    healthcheck:
      test: curl -f http://localhost:${ports[0]?.port}/health
      interval: 10s
    networks: [helio_internal]
    labels:
      caddy: ${ports[0]?.host || ""}
      caddy.reverse_proxy: '{{upstreams ${ports[0]?.port}}}'`;
  };

  const publicPort = ports.find((p) => p.public);

  return (
    <>
      <SectionH title="Review" sub="Confirm and deploy — you can change all of this later" />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginTop: 14,
        }}
      >
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
            summary
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            <ReviewRow label="Type" value={kind?.name} />
            <ReviewRow label="Name" value={name} />
            {!isDb && src && (
              <ReviewRow
                label="Source"
                value={
                  src === "github"
                    ? `github.com/${repo} · ${branch}`
                    : src === "cli"
                      ? "CLI push"
                      : src
                }
              />
            )}
            {!isDb && root && <ReviewRow label="Root" value={root} />}
            {!isDb && builderId && (
              <ReviewRow
                label="Builder"
                value={BUILDERS.find((b) => b.id === builderId)?.name}
              />
            )}
            {kind?.id === "docker" && <ReviewRow label="Image" value={`${image}:${tag}`} />}
            {isDb && version && <ReviewRow label="Version" value={`${kind?.id} ${version}`} />}
            {ports[0] && (
              <ReviewRow
                label="Ports"
                value={ports
                  .map((p) => `${p.port}/${p.protocol}${p.public ? " (public)" : ""}`)
                  .join(", ")}
              />
            )}
            {publicPort && <ReviewRow label="Public route" value={`https://${publicPort.host}`} />}
            <ReviewRow
              label="Resources"
              value={`${cpu} vCPU · ${mem >= 1024 ? mem / 1024 + " GB" : mem + " MB"} per replica`}
            />
            {!isDb && (
              <ReviewRow label="Replicas" value={`${replicas} · ${reg?.flag} ${reg?.name}`} />
            )}
            {isDb && (
              <ReviewRow
                label="Storage"
                value={`${storageGb} GB · backups ${backupsEnabled ? "on" : "off"}`}
              />
            )}
            <ReviewRow label="Network" value={`${name}.helio.internal`} last />
          </div>

          <div style={{ height: 14 }} />
          <div
            className="card"
            style={{ padding: 12, background: "var(--info-bg)", borderColor: "var(--info)" }}
          >
            <div className="row gap-2" style={{ alignItems: "flex-start" }}>
              <I.bolt
                width={14}
                height={14}
                style={{ color: "var(--info)", flexShrink: 0, marginTop: 2 }}
              />
              <div style={{ fontSize: 12, color: "var(--info)", lineHeight: 1.5 }}>
                Otterstack will{" "}
                {isDb
                  ? "pull the image, provision a volume, and start the database"
                  : "build the image, push to the internal registry, deploy " +
                    replicas +
                    " replica" +
                    (replicas > 1 ? "s" : "") +
                    " via Docker Swarm"}
                , register internal DNS, and{" "}
                {publicPort
                  ? "update the Caddy edge proxy with a fresh TLS cert"
                  : "wire it onto the internal network"}{" "}
                — usually about {isDb ? "45" : "90"} seconds.
              </div>
            </div>
          </div>
        </div>

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
            generated · compose.yml
          </div>
          <pre
            className="mono"
            style={{
              background: "var(--bg-sunken)",
              padding: 14,
              borderRadius: 8,
              fontSize: 11.5,
              lineHeight: 1.65,
              border: "1px solid var(--border)",
              color: "var(--fg-2)",
              margin: 0,
              overflow: "auto",
              maxHeight: 480,
              whiteSpace: "pre",
            }}
          >
            {generateCompose()}
          </pre>
          <div className="row gap-2" style={{ marginTop: 8 }}>
            <button className="btn sm">
              <I.copy width={11} height={11} /> Copy
            </button>
            <button className="btn sm">
              <I.doc width={11} height={11} /> Save as preset
            </button>
            <div style={{ flex: 1 }} />
            <span className="muted mono" style={{ fontSize: 11, alignSelf: "center" }}>
              otterstack apply
            </span>
          </div>
        </div>
      </div>
    </>
  );
}

function ReviewRow({
  label,
  value,
  last,
}: {
  label: string;
  value?: string;
  last?: boolean;
}) {
  if (!value) return null;
  return (
    <div
      className="row"
      style={{
        padding: "9px 12px",
        borderBottom: last ? "none" : "1px solid var(--border)",
        fontSize: 12,
        alignItems: "flex-start",
      }}
    >
      <span
        className="muted"
        style={{ width: 100, fontSize: 11, paddingTop: 1, flexShrink: 0 }}
      >
        {label}
      </span>
      <span
        className="mono"
        style={{ flex: 1, color: "var(--fg)", wordBreak: "break-word" }}
      >
        {value}
      </span>
    </div>
  );
}
