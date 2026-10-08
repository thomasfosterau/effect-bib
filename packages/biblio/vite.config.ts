import { defineConfig } from "vite-plus";

/**
 * Input fingerprint for this package's cached tasks: auto tracking minus
 * node_modules bookkeeping churn (pnpm rewrites `.modules.yaml` on every
 * install), with the lockfile back explicitly so a dependency upgrade still
 * invalidates a type-check or a test run.
 */
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

/**
 * CI caps the vitest fork count through VITEST_MAX_WORKERS; locally vitest's
 * own default applies, so the key is only present when the cap is.
 */
const workerCap = process.env.VITEST_MAX_WORKERS;
const testConfig = {
  include: ["tests/**/*.test.ts"],
  testTimeout: 30_000,
  coverage: {
    provider: "istanbul" as const,
    reporter: ["text-summary", "json-summary"],
    reportsDirectory: "./coverage",
    include: ["src/**/*.ts"],
    exclude: ["**/*.d.ts"],
    thresholds: { statements: 92, branches: 84, functions: 100, lines: 96 },
  },
};

export default defineConfig({
  run: {
    tasks: {
      // `tests/` is in the program too, so the type-level tests
      // (`tests/**/*.types.ts`, whose expect-error directives are the
      // assertions) are checked here alongside the sources.
      check: {
        command: "tsc -p tsconfig.json",
        input: cacheInputs,
        output: [],
      },
      // Emits `dist/` (JavaScript + declarations) with the native, Effect-
      // patched `tsc`. `rm -rf` first so a renamed module leaves no stale file.
      build: {
        command: "rm -rf dist && tsc -p tsconfig.build.json",
        input: cacheInputs,
        output: ["dist/**"],
      },
      // Compiles AND executes every JSDoc `@example` under src/ (docgen.json),
      // writing the generated module docs to docs/ (gitignored: the README is
      // the API reference; this task is the gate that keeps the examples true).
      docgen: {
        command: "docgen",
        input: cacheInputs,
        output: ["docs/**"],
      },
      // Both test tasks build first: `tests/entry-points.test.ts` re-walks
      // and loads the built `dist/`, and skips those cases without it (#22).
      "test:unit": {
        command: "vp test run tests",
        dependsOn: ["build"],
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        input: cacheInputs,
        output: [],
      },
      "test:coverage": {
        command: "vp test run tests --coverage",
        dependsOn: ["build"],
        env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
        input: cacheInputs,
        output: ["coverage/**"],
      },
    },
  },
  test: workerCap === undefined ? testConfig : { ...testConfig, maxWorkers: Number(workerCap) },
});
