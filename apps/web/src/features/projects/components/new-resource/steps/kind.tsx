import { useStore } from "@tanstack/react-form";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";

import type { Port } from "../form-fields/ports-field";

import { useFormContext } from "../form-context";
import { DOCKER_PORT_DEFAULTS } from "../image-defaults";
import { KindPicker } from "../kind-picker";
import { resourceDefaults } from "../schemas";

interface StepKindProps {
  dbView: boolean;
  onDbViewChange: (open: boolean) => void;
}

// Only reseed the ports row on a kind switch while it's still pristine —
// one of the two known default shapes. A row the operator touched survives.
function isPristinePorts(ports: Port[]): boolean {
  const json = JSON.stringify(ports);
  return (
    json === JSON.stringify(resourceDefaults.ports) || json === JSON.stringify(DOCKER_PORT_DEFAULTS)
  );
}

export function StepKind({ dbView, onDbViewChange }: StepKindProps) {
  const form = useFormContext();
  const kindId = useStore(form.store, (s) => s.values.kindId as string);

  return (
    <KindPicker
      value={kindId || null}
      dbView={dbView}
      onDbViewChange={onDbViewChange}
      onChange={(id) => {
        form.setFieldValue("kindId", id);
        const k = SERVICE_KINDS.find((x) => x.id === id);
        if (k) {
          // Docker-image services derive their name from the image basename
          // (image step) — seeding the source kind's id ("docker") ships a
          // service literally named docker when nobody notices.
          form.setFieldValue("name", k.id === "docker" ? "" : k.id);
          form.setFieldValue("version", k.versions && k.versions.length > 0 ? k.versions[0] : null);
          if (isPristinePorts(form.getFieldValue("ports"))) {
            // Docker flow starts with an EMPTY port (known images fill it on
            // the image step); git flows keep the detection-driven default.
            form.setFieldValue(
              "ports",
              (k.id === "docker" ? DOCKER_PORT_DEFAULTS : resourceDefaults.ports).map((p) => ({
                ...p,
              })),
            );
          }
        }
      }}
    />
  );
}
