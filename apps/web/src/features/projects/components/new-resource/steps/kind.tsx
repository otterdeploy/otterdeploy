import { useStore } from "@tanstack/react-form";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";

import { useFormContext } from "../form-context";
import { KindPicker, type KindTab } from "../kind-picker";
import { SectionHeader } from "../form-primitives";

export type { KindTab };

interface StepKindProps {
  initialTab?: KindTab;
}

export function StepKind({ initialTab }: StepKindProps) {
  const form = useFormContext();
  const kindId = useStore(form.store, (s) => s.values.kindId as string | "");

  return (
    <>
      <SectionHeader
        title="What do you want to deploy?"
        sub="Pick a service type to get a tailored creation flow"
      />
      <KindPicker
        value={kindId || null}
        onChange={(id) => {
          form.setFieldValue("kindId", id);
          const k = SERVICE_KINDS.find((x) => x.id === id);
          if (k) {
            form.setFieldValue("name", k.id);
            form.setFieldValue(
              "version",
              k.versions && k.versions.length > 0 ? k.versions[0] : null,
            );
          }
        }}
        initialTab={initialTab}
      />
    </>
  );
}
