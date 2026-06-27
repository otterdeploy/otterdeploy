import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
/// <reference types="vitest" />
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tanstackRouter({ routeToken: "layout" }), react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    globals: false,
    css: false,
  },
});
