import { createFileRoute } from "@tanstack/react-router";

// `/projects/$project/$env`: that environment on the canvas. The canvas layout
// (../layout.tsx) renders it; nothing renders here.
export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug/_canvas/$envSlug/")({});
