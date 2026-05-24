// Step_Review — summary table + generated compose snippet.
// Ported verbatim from apps/web-demo/src/features/otterstack/screens/new-service.tsx lines 2715-3014.
import { RESOURCE_PRESETS, BUILDERS, type ServiceKindDef } from "@/features/projects/data/service-kinds";
import type { ResourceFormValues } from "./schema";
import { SectionH } from "./form-primitives";
import { I } from "./icons";

type ReviewProps = {
  values: ResourceFormValues;
  kind: ServiceKindDef;
};

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
      className="os-row"
      style={{
        padding: "9px 12px",
        borderBottom: last ? "none" : "1px solid var(--border)",
        fontSize: 12,
        alignItems: "flex-start",
      }}
    >
      <span className="os-muted" style={{ width: 100, fontSize: 11, paddingTop: 1, flexShrink: 0 }}>
        {label}
      </span>
      <span className="os-mono" style={{ flex: 1, color: "var(--foreground)", wordBreak: "break-word" }}>
        {value}
      </span>
    </div>
  );
}

export function StepReview({ values, kind }: ReviewProps) {
  const {
    name,
    version,
    presetId,
    customCpu,
    customMem,
    replicas,
    storageGb,
    backupsEnabled,
  } = values;

  const preset = RESOURCE_PRESETS.find((p) => p.id === presetId);
  const cpu = preset?.cpu ?? customCpu;
  const mem = preset?.mem ?? customMem;
  const isDb = kind.group === "data";

  const generateCompose = () => {
    const memStr = mem >= 1024 ? `${mem / 1024}G` : `${mem}M`;
    if (isDb) {
      return `services:
  ${name}:
    image: ${kind.id}:${version}
    deploy:
      replicas: 1
      resources:
        limits: { cpus: '${cpu}', memory: ${memStr} }
    volumes:
      - ${name}-data:/var/lib/${kind.id === "postgres" ? "postgresql/data" : kind.id}
    networks: [internal]

volumes:
  ${name}-data:
    driver_opts: { size: '${storageGb}G' }`;
    }
    return `services:
  ${name}:
    deploy:
      replicas: ${replicas}
      resources:
        limits: { cpus: '${cpu}', memory: ${memStr} }
      update_config:
        order: start-first
        failure_action: rollback
    networks: [internal]`;
  };

  return (
    <>
      <SectionH
        title="Review"
        sub="Confirm and deploy — you can change all of this later"
      />

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
            className="os-muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}
          >
            summary
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            <ReviewRow label="Type" value={kind.name} />
            <ReviewRow label="Name" value={name} />
            {isDb && version && (
              <ReviewRow label="Version" value={`${kind.id} ${version}`} />
            )}
            <ReviewRow
              label="Resources"
              value={`${cpu} vCPU · ${mem >= 1024 ? mem / 1024 + " GB" : mem + " MB"} per replica`}
            />
            {isDb && (
              <ReviewRow
                label="Storage"
                value={`${storageGb} GB · backups ${backupsEnabled ? "on" : "off"}`}
              />
            )}
            {!isDb && (
              <ReviewRow label="Replicas" value={`${replicas}`} />
            )}
            <ReviewRow label="Network" value={`${name}.internal`} last />
          </div>

          <div style={{ height: 14 }} />
          <div
            className="card"
            style={{ padding: 12, background: "var(--muted)", borderColor: "var(--border)" }}
          >
            <div className="os-row os-gap-2" style={{ alignItems: "flex-start" }}>
              <I.bolt
                width={14}
                height={14}
                style={{ color: "var(--muted-foreground)", flexShrink: 0, marginTop: 2 }}
              />
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                Otterstack will{" "}
                {isDb
                  ? "pull the image, provision a volume, and start the database"
                  : `build the image, push to the internal registry, deploy ${replicas} replica${replicas > 1 ? "s" : ""} via Docker Swarm`}
                , register internal DNS, and wire it onto the internal network —
                usually about {isDb ? "45" : "90"} seconds.
              </div>
            </div>
          </div>
        </div>

        <div>
          <div
            className="os-muted"
            style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}
          >
            generated · compose.yml
          </div>
          <pre
            className="os-mono"
            style={{
              background: "var(--muted)",
              padding: 14,
              borderRadius: 8,
              fontSize: 11.5,
              lineHeight: 1.65,
              border: "1px solid var(--border)",
              color: "var(--muted-foreground)",
              margin: 0,
              overflow: "auto",
              maxHeight: 480,
              whiteSpace: "pre",
            }}
          >
            {generateCompose()}
          </pre>
          <div className="os-row os-gap-2" style={{ marginTop: 8 }}>
            <button type="button" className="btn sm">
              <I.copy width={11} height={11} /> Copy
            </button>
            <button type="button" className="btn sm">
              <I.doc width={11} height={11} /> Save as preset
            </button>
            <div style={{ flex: 1 }} />
            <span className="os-muted os-mono" style={{ fontSize: 11, alignSelf: "center" }}>
              otterstack apply
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
