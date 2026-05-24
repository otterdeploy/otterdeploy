// New resource creation — Pass A: engine-picker scaffold only.
// Pass B (separate session) will add multi-step wizard with tanstack-form + zod.
import { useState } from "react";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";

import { StepKind } from "@/features/projects/components/new-resource/step-kind";
import { Stepper, type Step } from "@/features/projects/components/new-resource/stepper";
import { ID_PREFIX, type Slug } from "@otterstack/shared/id";

export const Route = createFileRoute("/_app/$orgSlug/$projectSlug/new-resource")({
  staticData: { crumb: "New resource" },
  component: RouteComponent,
});

const STEPS: Array<[Step, string, string]> = [
  ["kind", "Kind", "pick-kind"],
  ["version", "Version", "pick-version"],
  ["resources", "Resources", "pick-resources"],
  ["review", "Review", "review"],
];

function RouteComponent() {
  const { organization } = useLoaderData({ from: "/_app/$orgSlug" });
  const { project } = useLoaderData({ from: "/_app/$orgSlug/$projectSlug" });

  const [kindId, setKindId] = useState<string | null>(null);

  const orgSlug = organization.slug;
  const projectSlug = project.slug as Slug<typeof ID_PREFIX.project>;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--background)",
        color: "var(--foreground)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 22px",
          borderBottom: "1px solid var(--border)",
          background: "var(--card)",
          flexShrink: 0,
        }}
      >
        <Link
          to="/$orgSlug/$projectSlug"
          params={{ orgSlug, projectSlug }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--muted-foreground)",
            textDecoration: "none",
          }}
        >
          <svg
            viewBox="0 0 16 16"
            width={12}
            height={12}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 4l-4 4 4 4" />
          </svg>
          {project.name}
        </Link>
        <span style={{ color: "var(--border)", fontSize: 14 }}>/</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Create resource</span>
      </div>

      {/* Stepper */}
      <Stepper steps={STEPS} idx={0} setStep={() => {}} />

      {/* Body — scrollable */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "22px 22px 0",
        }}
      >
        <StepKind kindId={kindId} setKindId={setKindId} />
      </div>

      {/* Bottom bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          padding: "12px 22px",
          borderTop: "1px solid var(--border)",
          background: "var(--card)",
          flexShrink: 0,
        }}
      >
        <Link
          to="/$orgSlug/$projectSlug"
          params={{ orgSlug, projectSlug }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 32,
            padding: "0 14px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--background)",
            color: "var(--foreground)",
            fontSize: 13,
            fontWeight: 500,
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          Cancel
        </Link>
        <button
          disabled
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 32,
            padding: "0 14px",
            borderRadius: 6,
            border: "1px solid transparent",
            background: "var(--foreground)",
            color: "var(--background)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "not-allowed",
            opacity: kindId ? 1 : 0.45,
            fontFamily: "inherit",
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}
