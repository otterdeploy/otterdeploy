import { createFileRoute } from "@tanstack/react-router";

// `/projects/$project`: the project's default environment on the canvas. The
// canvas layout (./layout.tsx) renders it; with no environment in the path,
// `useActiveEnvironment` resolves the project's default. No redirect.
export const Route = createFileRoute("/_app/$orgSlug/_shell/projects/$projectSlug/_canvas/")({});
