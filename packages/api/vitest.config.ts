import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `*.redis.test.ts` needs a live Redis and runs in the CI `integration`
    // job instead — see vitest.redis.config.ts and the `test:integration`
    // script. Excluded here rather than skipped at runtime: a security test
    // that silently skips when its infrastructure is missing is one that never
    // runs, which is worse than one honestly absent from this leg.
    //
    // The vitest defaults are restated because setting `exclude` REPLACES them
    // rather than extending them — dropping them would start walking
    // node_modules.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.redis.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
