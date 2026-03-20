import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    
    POLAR_SUCCESS_URL: z.url(),
    POLAR_ACCESS_TOKEN: z.string().min(1),
    
    CORS_ORIGIN: z.url(),
    
    RESEND_API_KEY: z.string().min(1),
    RESEND_FROM_EMAIL: z.email().default("onboarding@resend.dev"),
    
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
