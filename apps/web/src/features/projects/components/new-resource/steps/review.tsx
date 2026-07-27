import type { ProjectId } from "@otterdeploy/shared/id";

import { useStore } from "@tanstack/react-form";

import type { ServiceKind } from "@/features/projects/data/service-kinds";

import { useFormContext } from "../form-context";
import { SectionHeader } from "../form-primitives";
import { usePublicHostPreview } from "../use-public-host-preview";
import { buildReviewModel } from "./review-model";
import { ApplyNote, ComposePreview, ReviewSummaryCard, SectionLabel } from "./review-parts";

interface StepReviewProps {
  kind: ServiceKind;
  projectId: ProjectId;
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
        const model = buildReviewModel(kind, values, derivedHost);

        return (
          <>
            <SectionHeader
              title="Review"
              sub="Add this resource, then apply it from the pending-changes bar — you can change all of this later"
            />

            <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <SectionLabel>summary</SectionLabel>
                <ReviewSummaryCard kind={kind} model={model} />
                <ApplyNote kind={kind} model={model} />
              </div>

              <div>
                <SectionLabel>generated · compose.yml</SectionLabel>
                <ComposePreview compose={model.compose} />
              </div>
            </div>
          </>
        );
      }}
    </form.Subscribe>
  );
}
