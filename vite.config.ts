import { defineConfig } from "vite-plus";
import { packageTest } from "../../tooling/test-config";

export default defineConfig({
  test: packageTest({
    thresholds: { statements: 92, branches: 84, functions: 100, lines: 96 },
    needsMocks: true,
  }),
});
