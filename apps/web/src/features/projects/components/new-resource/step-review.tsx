// Step_Review — summary table + generated compose snippet.
// Change 1: region row removed. Change 2: cost removed. Change 4: Tailwind conversion.
import { RESOURCE_PRESETS, type ServiceKindDef } from "@/features/projects/data/service-kinds";
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
      className={`flex items-start py-[9px] px-3 text-xs${last ? "" : " border-b border-border"}`}
    >
      <span className="text-muted-foreground text-[11px] pt-px shrink-0 w-[100px]">
        {label}
      </span>
      <span className="font-mono flex-1 text-foreground break-words">
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

      <div className="grid grid-cols-2 gap-3 mt-[14px]">
        <div>
          <div className="text-muted-foreground text-[10px] uppercase tracking-[0.06em] mb-1.5">
            summary
          </div>
          <div className="card overflow-hidden">
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
              <ReviewRow
                label="Replicas"
                value={`${replicas}`}
              />
            )}
            <ReviewRow label="Network" value={`${name}.internal`} last />
          </div>

          <div className="h-[14px]" />
          <div className="card p-3 bg-muted border-border">
            <div className="flex items-start gap-2">
              <I.bolt
                width={14}
                height={14}
                className="text-muted-foreground shrink-0 mt-0.5"
              />
              <div className="text-xs text-muted-foreground leading-relaxed">
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
          <div className="text-muted-foreground text-[10px] uppercase tracking-[0.06em] mb-1.5">
            generated · compose.yml
          </div>
          <pre
            className="font-mono bg-muted p-[14px] rounded-lg text-[11.5px] leading-[1.65] border border-border text-muted-foreground m-0 overflow-auto max-h-[480px] whitespace-pre"
          >
            {generateCompose()}
          </pre>
          <div className="flex items-center gap-2 mt-2">
            <button type="button" className="btn sm">
              <I.copy width={11} height={11} /> Copy
            </button>
            <button type="button" className="btn sm">
              <I.doc width={11} height={11} /> Save as preset
            </button>
            <div className="flex-1" />
            <span className="text-muted-foreground font-mono text-[11px] self-center">
              otterstack apply
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
