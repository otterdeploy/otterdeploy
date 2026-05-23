import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { SignInForm } from "@/features/auth/components/sign-in-form";

const search = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/_auth/sign-in")({
  validateSearch: search,
  component: SignInForm,
});
