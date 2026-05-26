import {
  RESOURCE_PRESETS,
  type ServiceKind,
} from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { I } from "../icons";

interface StepReviewProps {
  kind: ServiceKind;
}

export function StepReview({ kind }: StepReviewProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(s) => s.values}>
      {(values) => {
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

        const compose = generateCompose();

        return (
          <>
            <SectionHeader
              title="Review"
              sub="Confirm and deploy — you can change all of this later"
            />

            <div className="mt-3.5 grid grid-cols-2 gap-3">
              <div>
                <SectionLabel>summary</SectionLabel>
                <Card className="overflow-hidden rounded-md p-0 gap-0">
                  <ReviewRow label="Type" value={kind.name} />
                  <ReviewRow label="Name" value={name} />
                  {isDb && version && (
                    <ReviewRow
                      label="Version"
                      value={`${kind.id} ${version}`}
                    />
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
                </Card>

                <Card className="mt-3.5 rounded-md bg-muted p-3 gap-0">
                  <div className="flex items-start gap-2">
                    <I.bolt
                      width={14}
                      height={14}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Otterstack will{" "}
                      {isDb
                        ? "pull the image, provision a volume, and start the database"
                        : `build the image, push to the internal registry, deploy ${replicas} replica${replicas > 1 ? "s" : ""} via Docker Swarm`}
                      , register internal DNS, and wire it onto the internal
                      network — usually about {isDb ? "45" : "90"} seconds.
                    </p>
                  </div>
                </Card>
              </div>

              <div>
                <SectionLabel>generated · compose.yml</SectionLabel>
                <pre className="m-0 max-h-120 overflow-auto rounded-md border bg-muted p-3.5 font-mono text-[11.5px] leading-relaxed text-muted-foreground whitespace-pre">
                  {compose}
                </pre>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => void navigator.clipboard.writeText(compose)}
                  >
                    <I.copy width={11} height={11} />
                    Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                  >
                    <I.doc width={11} height={11} />
                    Save as preset
                  </Button>
                  <div className="flex-1" />
                  <span className="self-center font-mono text-[11px] text-muted-foreground">
                    otterstack apply
                  </span>
                </div>
              </div>
            </div>
          </>
        );
      }}
    </form.Subscribe>
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
      className={`flex items-start px-3 py-2 text-xs ${last ? "" : "border-b border-border/60"}`}
    >
      <span className="w-24 shrink-0 pt-0.5 text-[11px] text-muted-foreground">
        {label}
      </span>
      <span className="flex-1 font-mono wrap-break-word text-foreground">
        {value}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}
