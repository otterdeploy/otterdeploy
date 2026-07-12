import { useStore } from "@tanstack/react-form";

import { SERVICE_KINDS } from "@/features/projects/data/service-kinds";

import { useFormContext } from "../form-context";
import { KindPicker } from "../kind-picker";

interface StepKindProps {
  dbView: boolean;
  onDbViewChange: (open: boolean) => void;
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
          form.setFieldValue("name", k.id);
          form.setFieldValue("version", k.versions && k.versions.length > 0 ? k.versions[0] : null);
        }
      }}
    />
  );
}
