import type { ProjectId } from "@otterdeploy/shared/id";

import { POSTGRES_EXTENSIONS, resolvePostgresImage } from "@otterdeploy/shared/postgres-extensions";
import { useStore } from "@tanstack/react-form";

import { RESOURCE_PRESETS, type ServiceKind } from "@/features/projects/data/service-kinds";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { copyToClipboard } from "@/shared/lib/clipboard";

import type { ResourceFormState } from "../schemas";

import { traitsFor } from "../engine-traits";
import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { I } from "../icons";
import { domainsFromPorts } from "../to-manifest";
import { usePublicHostPreview } from "../use-public-host-preview";

interface StepReviewProps {
  kind: ServiceKind;
  projectId: ProjectId;
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
  publicEnabled: boolean;
  /** Pre-built image ref for docker-kind services ("" for git builds). */
  serviceImage: string;
  /** Public hostnames this service's manifest will seed (services only —
   *  same mapper as the create payload, so preview == staged). */
  serviceDomains: string[];
  healthPath: string;
  healthInterval: number;
}

// Preview mirrors what actually deploys: a plain named volume (the
// provisioner applies no size/driver_opts — see the Storage step) and the
// hardcoded start-first/rollback update strategy from the swarm driver.
function generateComposeYaml(args: ComposeArgs): string {
  const { isDb, kindId, name, dbImage, isPg, extensions, cpu, mem, replicas } = args;
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
  ${name}-data:`;
  }
  const imageLine = args.serviceImage
    ? `\n    image: ${args.serviceImage}`
    : `\n    # image: built from source on deploy`;
  const healthBlock =
    args.healthPath.trim() !== ""
      ? `\n    healthcheck:
      test: wget/curl http://127.0.0.1:<primary port>${args.healthPath.trim()}
      interval: ${args.healthInterval}s`
      : "";
  const isPublic = args.serviceDomains.length > 0;
  const routeLines = isPublic
    ? args.serviceDomains.map((d) => `\n    # public route: https://${d}`).join("")
    : "";
  return `services:
  ${name}:${imageLine}${routeLines}${healthBlock}
    deploy:
      replicas: ${replicas}
      resources:
        limits: { cpus: '${cpu}', memory: ${memStr} }
      update_config:
        order: start-first
        failure_action: rollback
    networks: [internal${isPublic ? ", public" : ""}]`;
}

/** Derive every value the Review JSX renders from the live form state.
 *  Pulling this out of the render prop keeps that callback under the
 *  cyclomatic-complexity cap. */
function buildReviewModel(
  kind: ServiceKind,
  values: ResourceFormState,
  derivedHost: string | null,
) {
  const { name, version, presetId, customCpu, customMem, replicas } = values;
  const { publicEnabled, healthPath, healthInterval } = values;
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

  // Docker-kind services deploy the exact ref typed on the Image step;
  // git kinds get their image from the first build.
  const serviceImage =
    kind.id === "docker" && values.image
      ? values.tag
        ? `${values.image}:${values.tag}`
        : values.image
      : "";

  // Service access derives from the SAME mapper the create payload uses
  // (domainsFromPorts) — the Review step previously read the database-only
  // `publicEnabled` flag for services, so a Public port toggle reviewed as
  // "Internal only" while the diff staged routes. Preview == staged, always.
  const serviceDomains =
    isDb || kind.id === "static"
      ? []
      : (domainsFromPorts(values.ports, derivedHost) ?? []).map((d) => d.domain);

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
    publicEnabled,
    serviceImage,
    serviceDomains,
    healthPath: kind.id === "static" ? "" : healthPath,
    healthInterval,
  });

  return {
    name,
    version,
    cpu,
    mem,
    isDb,
    isPg,
    replicas,
    publicEnabled,
    serviceDomains,
    extensions,
    extensionLabels,
    compose,
    mountTarget: isDb ? traitsFor(kind.id).mountTarget : null,
  };
}

export function StepReview({ kind, projectId }: StepReviewProps) {
  const form = useFormContext();
  // Hostname a public port with no typed host will publish at — resolved
  // server-side so Review shows the same FQDN the create will stage.
  const formName = useStore(form.store, (s) => s.values.name);
  const derivedHost = usePublicHostPreview(projectId, formName);
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
          publicEnabled,
          serviceDomains,
          extensions,
          extensionLabels,
          compose,
          mountTarget,
        } = buildReviewModel(kind, values, derivedHost);
        const isPublic = isDb ? publicEnabled : serviceDomains.length > 0;

        return (
          <>
            <SectionHeader
              title="Review"
              sub="Add this resource, then apply it from the pending-changes bar — you can change all of this later"
            />

            <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  {isDb && mountTarget && (
                    // Honest storage summary: a plain named volume with no
                    // sizing/backup policy — backups are scheduled post-deploy.
                    <ReviewRow label="Storage" value={`named volume · ${mountTarget}`} />
                  )}
                  {isPg && extensions.length > 0 && (
                    <ReviewRow label="Extensions" value={extensionLabels} />
                  )}
                  {!isDb && <ReviewRow label="Replicas" value={`${replicas}`} />}
                  <ReviewRow
                    label="Access"
                    value={
                      isPublic
                        ? isDb
                          ? "Public (exposed)"
                          : `Public — ${serviceDomains.join(", ")}`
                        : "Internal only"
                    }
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
                        : kind.id === "docker"
                          ? // Registry pulls don't build or push anything — the
                            // exact ref from the Image step is pulled and run.
                            `pull the image and deploy ${replicas} replica${replicas > 1 ? "s" : ""} via Docker Swarm`
                          : `build the image from source and deploy ${replicas} replica${replicas > 1 ? "s" : ""} via Docker Swarm`}
                      , register internal DNS, and wire it onto the internal network — usually about{" "}
                      {isDb || kind.id === "docker" ? "45" : "90"} seconds.
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
                    onClick={() => void copyToClipboard(compose)}
                  >
                    <I.copy width={11} height={11} />
                    Copy
                  </Button>
                  {/* "Save as preset" removed — there is no preset store; a
                      button that saves nothing is a fake control. */}
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
