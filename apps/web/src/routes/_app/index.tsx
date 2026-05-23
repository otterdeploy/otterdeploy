import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/")({
  beforeLoad: ({ context }) => {
    throw redirect({
      to: "/$orgSlug",
      params: { orgSlug: context.activeOrgSlug },
    });
  },
});
