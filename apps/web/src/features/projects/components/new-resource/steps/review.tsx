import { POSTGRES_EXTENSIONS, resolvePostgresImage } from "@otterdeploy/shared/postgres-extensions";

import { RESOURCE_PRESETS, type ServiceKind } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";

import type { ResourceFormState } from "../schemas";

import { traitsFor } from "../engine-traits";
import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { I } from "../icons";

interface StepReviewProps {
  kind: ServiceKind;
}

interface ComposeArgs {
  isDb: boolean;
  kindId: string;
  name: string;
  dbImage: string;
  isPg: boolean;
  extensions: string[];
  cpu: number;
  mem: number;
  replicas: number;
  storageGb: number;
  publicEnabled: boolean;
}

function generateComposeYaml(args: ComposeArgs): string {
  const { isDb, kindId, name, dbImage, isPg, extensions, cpu, mem, replicas, storageGb } = args;
  const memStr = mem >= 1024 ? `${mem / 1024}G` : `${mem}M`;
  if (isDb) {
    const mountTarget = traitsFor(kindId).mountTarget;
    const extLine =
      isPg && extensions.length > 0 ? `\n    # extensions: ${extensions.join(", ")}` : "";
    return `services:
  ${name}:
    image: ${dbImage}${extLine}
    deploy:
      replicas: 1
      resources:
        limits: { cpus: '${cpu}', memory: ${memStr} }
    volumes:
      - ${name}-data:${mountTarget}
    networks: [internal${args.publicEnabled ? ", public" : ""}]

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
}

/** Derive every value the Review JSX renders from the live form state.
 *  Pulling this out of the render prop keeps that callback under the
 *  cyclomatic-complexity cap. */
function buildReviewModel(kind: ServiceKind, values: ResourceFormState) {
  const { name, version, presetId, customCpu, customMem, replicas, storageGb } = values;
  const { backupsEnabled, publicEnabled } = values;
  const preset = RESOURCE_PRESETS.find((p) => p.id === presetId);
  const cpu = preset?.cpu ?? customCpu;
  const mem = preset?.mem ?? customMem;
  const isDb = kind.group === "database";

  // Selected postgres extensions (names), with their display labels.
  const extensions = (values.extensions as string[] | undefined) ?? [];
  const isPg = kind.id === "postgres";
  const extensionLabels = extensions
    .map((n) => POSTGRES_EXTENSIONS.find((e) => e.name === n)?.label ?? n)
    .join(", ");
  // Non-contrib extensions pin a specific image — reflect that in the
  // preview so the image line matches what actually deploys.
  const resolved = isPg ? resolvePostgresImage(extensions, `${kind.id}:${version}`) : null;
  const dbImage = resolved && resolved.ok ? resolved.image : `${kind.id}:${version}`;

  const compose = generateComposeYaml({
    isDb,
    kindId: kind.id,
    name,
    dbImage,
    isPg,
    extensions,
    cpu,
    mem,
    replicas,
    storageGb,
    publicEnabled,
  });

  return {
    name,
    version,
    cpu,
    mem,
    isDb,
    isPg,
    replicas,
    storageGb,
    backupsEnabled,
    publicEnabled,
    extensions,
    extensionLabels,
    compose,
  };
}

export function StepReview({ kind }: StepReviewProps) {
  const form = useFormContext();
  return (
    <form.Subscribe selector={(s) => s.values}>
      {(values) => {
        const {
          name,
          version,
          cpu,
          mem,
          isDb,
          isPg,
          replicas,
          storageGb,
          backupsEnabled,
          publicEnabled,
          extensions,
          extensionLabels,
          compose,
        } = buildReviewModel(kind, values);

        return (
          <>
            <SectionHeader
              title="Review"
              sub="Add this resource, then apply it from the pending-changes bar — you can change all of this later"
            />

            <div className="mt-3.5 grid grid-cols-2 gap-3">
              <div>
                <SectionLabel>summary</SectionLabel>
                <Card className="gap-0 overflow-hidden rounded-md p-0">
                  <ReviewRow label="Type" value={kind.name} />
                  <ReviewRow label="Name" value={name} />
                  {isDb && version && <ReviewRow label="Version" value={`${kind.id} ${version}`} />}
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
                  {isPg && extensions.length > 0 && (
                    <ReviewRow label="Extensions" value={extensionLabels} />
                  )}
                  {!isDb && <ReviewRow label="Replicas" value={`${replicas}`} />}
                  <ReviewRow
                    label="Access"
                    value={publicEnabled ? "Public (exposed)" : "Internal only"}
                  />
                  <ReviewRow label="Network" value={`${name}.internal`} last />
                </Card>

                <Card className="mt-3.5 gap-0 rounded-md bg-muted p-3">
                  <div className="flex items-start gap-2">
                    <I.bolt
                      width={14}
                      height={14}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      On apply, Otterdeploy will{" "}
                      {isDb
                        ? "pull the image, provision a volume, and start the database"
                        : `build the image, push to the internal registry, deploy ${replicas} replica${replicas > 1 ? "s" : ""} via Docker Swarm`}
                      , register internal DNS, and wire it onto the internal network — usually about{" "}
                      {isDb ? "45" : "90"} seconds.
                    </p>
                  </div>
                </Card>
              </div>

              <div>
                <SectionLabel>generated · compose.yml</SectionLabel>
                <pre className="m-0 max-h-120 overflow-auto rounded-md border bg-muted p-3.5 font-mono text-[11.5px] leading-relaxed whitespace-pre text-muted-foreground">
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
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
                    <I.doc width={11} height={11} />
                    Save as preset
                  </Button>
                  <div className="flex-1" />
                  <span className="self-center font-mono text-[11px] text-muted-foreground">
                    otterdeploy apply
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

function ReviewRow({ label, value, last }: { label: string; value?: string; last?: boolean }) {
  if (!value) return null;
  return (
    <div
      className={`flex items-start px-3 py-2 text-xs ${last ? "" : "border-b border-border/60"}`}
    >
      <span className="w-24 shrink-0 pt-0.5 text-[11px] text-muted-foreground">{label}</span>
      <span className="flex-1 font-mono wrap-break-word text-foreground">{value}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[10px] tracking-wider text-muted-foreground uppercase">
      {children}
    </div>
  );
}
