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
    // `json` writes coverage-final.json, the Istanbul map `fallow audit`
    // reads for exact per-function CRAP scores (`health.coverage` in
    // .fallowrc.json); without it every function scores as uncovered.
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
      // `tests/` is in the program too, so the type-level tests
      // (`tests/**/*.types.ts`, whose expect-error directives are the
      // assertions) are checked here alongside the sources.
      check: {
        command: "tsc -p tsconfig.json",
        cache: { input: cacheInputs, output: [] },
      },
      // Emits `dist/` (JavaScript + declarations) with the native, Effect-
      // patched `tsc`. `rm -rf` first so a renamed module leaves no stale file.
      //
      // Cacheable only as ONE task (#44). Vite+ splits a top-level `&&` into
      // sub-tasks cached apart, and the two halves each fingerprinted the
      // `dist/` the other then changed, so neither ever hit; `sh -c` keeps
      // the clean and the compile together. `dist/` stays an auto-tracked
      // input on purpose (never `!dist/**`, which let a stray file survive a
      // hit): the trailing `ls -R` lists the whole emitted tree after the
      // compile, so a hit needs `dist/` to hold exactly the files this build
      // wrote (whose contents a hit restores), and anything else there, from
      // a hand edit or a failed compile, is a miss that re-runs the clean.
      // `ls`, not `find`: on macOS Vite+ swaps in tracked copies of a fixed
      // list of system tools, and `ls` is on it but `find` is not.
      build: {
        command: "sh -c 'rm -rf dist && tsc -p tsconfig.build.json && ls -R dist > /dev/null'",
        cache: { input: cacheInputs, output: ["dist/**"] },
      },
      // Compiles AND executes every JSDoc `@example` under src/ (docgen.json),
      // writing the generated module docs to docs/ (gitignored: the README is
      // the API reference; this task is the gate that keeps the examples true).
      docgen: {
        command: "docgen",
        cache: { input: cacheInputs, output: ["docs/**"] },
      },
      // Fetches Pandoc's BibLaTeX test cases (GPL, so never vendored) at a
      // pinned commit into the git-ignored .oracles/, for the oracle test
      // (tests/bibtex-oracle.test.ts, #91). Network; CI runs it before the
      // tests, and the test fails under CI without it.
      "oracles:fetch": {
        command:
          'sh -c \'rm -rf .oracles/pandoc && git clone -q --filter=blob:none --no-checkout https://github.com/jgm/pandoc.git .oracles/pandoc && cd .oracles/pandoc && git sparse-checkout set --no-cone "/test/command/biblatex-*.md" "/test/command/bibtex-*.md" && git checkout -q 66fcaff9258133aa5d2e918abb7b7d5e5c4a39fd\'',
        cache: false,
      },
      // Both test tasks build first: `tests/entry-points.test.ts` re-walks
      // and loads the built `dist/`, and skips those cases without it (#22).
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
