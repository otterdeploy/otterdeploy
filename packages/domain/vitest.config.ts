import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "@otterdeploy/config/vitest.base";

export default mergeConfig(baseConfig, defineConfig({}));
