import { defineConfig } from "drizzle-kit";
import { env } from "@otterdeploy/env/server";

export default defineConfig({
  // Point at the barrel, not the directory: drizzle-kit 1.0-rc loads a
  // directory's files AND any re-exporting index, double-counting every
  // table and aborting with "duplicate" errors. The index re-exports every
  // schema file exactly once, so this loads each table a single time.
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
});
