import { defineConfig } from "vite-plus";

// Auto tracking minus node_modules churn (pnpm rewrites `.modules.yaml` on
// every install), with the lockfile back so an upgrade still invalidates.
const cacheInputs = [
  { auto: true },
  "!node_modules/**",
  { pattern: "!node_modules/**", base: "workspace" as const },
  { pattern: "pnpm-lock.yaml", base: "workspace" as const },
];

const workerCap = process.env.VITEST_MAX_WORKERS;
const testConfig = {
  include: ["tests/**/*.test.ts"],
  testTimeout: 30_000,
  coverage: {
    provider: "istanbul" as const,
    // `json` writes the coverage map `fallow audit` reads.
    reporter: ["text-summary", "json-summary", "json"],
    reportsDirectory: "./coverage",
    include: ["src/**/*.ts"],
    exclude: ["**/*.d.ts"],
    thresholds: { statements: 92, branches: 84, functions: 100, lines: 96 },
  },
};

export default defineConfig({
  run: {
    tasks: {
      // Includes the type-level tests (`tests/**/*.types.ts`).
      check: {
        command: "tsc -p tsconfig.json",
        cache: { input: cacheInputs, output: [] },
      },
      // `sh -c` keeps clean and compile one cached task (Vite+ splits a
      // top-level `&&`). `dist/` stays a tracked input: the trailing `ls -R`
      // makes any stray file in it a cache miss. `ls`, not `find`: Vite+
      // tracks only a fixed list of system tools on macOS.
      build: {
        command: "sh -c 'rm -rf dist && tsc -p tsconfig.build.json && ls -R dist > /dev/null'",
        cache: { input: cacheInputs, output: ["dist/**"] },
      },
      // Compiles and executes every JSDoc `@example`; docs/ is gitignored.
      docgen: {
        command: 'PATH="$(cd ../../scripts/bin && pwd):$PATH" docgen',
        cache: { input: cacheInputs, output: ["docs/**"] },
      },
      // Pandoc's BibLaTeX test cases (GPL, so never vendored) for
      // tests/bibtex-oracle.test.ts. Network; the test fails under CI without it.
      "oracles:fetch": {
        command:
          'sh -c \'rm -rf .oracles/pandoc && git clone -q --filter=blob:none --no-checkout https://github.com/jgm/pandoc.git .oracles/pandoc && cd .oracles/pandoc && git sparse-checkout set --no-cone "/test/command/biblatex-*.md" "/test/command/bibtex-*.md" && git checkout -q 66fcaff9258133aa5d2e918abb7b7d5e5c4a39fd\'',
        cache: false,
      },
      // `tests/entry-points.test.ts` loads the built `dist/`.
      "test:unit": {
        command: "vp test run tests",
        dependsOn: ["build"],
        cache: { env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"], input: cacheInputs, output: [] },
      },
      "test:coverage": {
        command: "vp test run tests --coverage",
        dependsOn: ["build"],
        cache: {
          env: ["VITEST_MAX_WORKERS", "NODE_OPTIONS"],
          input: cacheInputs,
          output: ["coverage/**"],
        },
      },
    },
  },
  test: workerCap === undefined ? testConfig : { ...testConfig, maxWorkers: Number(workerCap) },
});
