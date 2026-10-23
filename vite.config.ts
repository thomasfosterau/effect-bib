/**
 * @copyright Thomas Foster
 *
 * Root workspace config. Owns the repo-wide format/lint/staged passes (read
 * statically by `vp fmt` / `vp lint` / `vp staged`) and the root `check`
 * aggregate.
 *
 * Copied from the effect-drizzle-ext library (itself copied from the
 * gardeneria application's root config): every comment that explains a
 * load-bearing decision is part of the standard and travels with the config.
 */

import { defineConfig } from "vite-plus";
import { recommended } from "@effect/tsgo/oxlint-presets";
import effect from "@mpsuesser/oxlint-plugin-effect";

export default defineConfig({
  // Staged-file checks run by `vp staged` (pre-commit).
  staged: {
    "*.{js,ts,css,json,md}": "vp check --fix",
  },
  fmt: {
    overrides: [
      {
        files: ["**/*.md"],
        options: {
          proseWrap: "never",
        },
      },
    ],
  },
  lint: {
    extends: [recommended, effect.configs.recommended],
    categories: {
      correctness: "error",
    },
    rules: {
      "eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "eslint/prefer-const": "warn",
      // The `Buffer` global is typed `any` wherever a consumer loads
      // @cloudflare/workers-types next to @types/node (every application this
      // library serves), so every call on it is unchecked there. The library
      // never reaches for it: bytes are `Uint8Array` / `DataView`.
      "eslint/no-restricted-globals": [
        "error",
        {
          name: "Buffer",
          message:
            "The `Buffer` global is typed `any` wherever @cloudflare/workers-types is loaded. Use Uint8Array/DataView.",
        },
      ],
      // `casting-awareness` is an awareness prompt, not a defect rule — it
      // fires on every `as`, including the narrowings the lenient CSL-JSON
      // decoder structurally requires. Stays visible as a warning.
      "effect/casting-awareness": "warn",
      // Hard-codes abbreviations (`Arr`, `P`, `R`, …) with no options, so it is
      // unsatisfiable under the full-name convention (`import * as Option from
      // "effect/Option"`) this library shares with its consumers.
      "effect/prefer-namespace-imports": "off",

      // No ported-code allowances remain: every preset rule is at its `error`
      // level. `prefer-option-over-null` and `no-unknown-parameters` stay
      // there with a handful of per-site `oxlint-disable` justifications —
      // the plain-nullable seams and the untrusted-input boundary listed in
      // packages/biblio/CLAUDE.md — so a new site cannot land silently.
      "typescript/no-explicit-any": "off",
      "typescript/no-empty-object-type": "off",
      "typescript/ban-ts-comment": "off",
      "unicorn/no-empty-file": "off",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      // Build/test configs are evaluated by Vite and Vitest in bare Node,
      // before any Effect runtime exists — there is no `Config` provider to
      // read from and no `FileSystem` service to call, so `process.env` and
      // `node:*` are the only things that work there. The Effect preset's
      // service rules have no satisfiable fix in these files. The entry-point
      // graph test walks the source tree with `node:fs` for the same reason,
      // and the BibTeX oracle test reads its corpus (and, under
      // `ORACLE_BASELINE` / `ORACLE_REPORT`, writes its baseline) the same way.
      {
        files: [
          "**/vite.config.ts",
          "**/vitest.config.ts",
          "**/tests/entry-points.test.ts",
          "**/tests/bibtex-oracle.test.ts",
          "**/tests/fixtures/*.mjs",
        ],
        rules: {
          "effect/avoid-node-imports": "off",
          "effect/use-command-executor-service": "off",
          "effect/avoid-sync-fs": "off",
          "effect/avoid-process-env": "off",
          "effect/use-console-service": "off",
          "effect/use-filesystem-service": "off",
          "effect/use-path-service": "off",
          "effect/avoid-native-fetch": "off",
          "effect/effect-promise-vs-trypromise": "off",
        },
      },
      // The suite's run helpers ARE the test harness boundary the rule
      // points to, but it has no entrypoint detection: running the Effect is
      // their whole job (`@effect/vitest`'s `it.effect` does not load under
      // the Vite+ vitest alias; see the module comment).
      {
        files: ["packages/biblio/tests/effect.ts"],
        rules: {
          "effect/effect-run-in-body": "off",
        },
      },
      // Type-level tests: every binding exists to be assigned, never read,
      // and an expect-error directive IS the assertion there — the one place
      // the preset's ban on it does not apply.
      {
        files: ["**/*.types.ts"],
        rules: {
          "eslint/no-unused-vars": "off",
          "effect/avoid-ts-ignore": "off",
        },
      },
    ],
    // Type-aware linting is intentionally disabled: type checking stays the
    // `check` tasks' job (native tsc, Effect-patched).
    options: {
      typeAware: false,
      typeCheck: false,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  run: {
    tasks: {
      // The CI typecheck gate, as one task: every package's `check`, plus the
      // dist-consumer check that type-checks a consumer fixture against the
      // EMITTED declarations (the identifier brands must survive declaration
      // emit — a brand that degrades to `string` only shows up there). A pure
      // graph node.
      check: {
        command: "echo 'check: every type gate green'",
        dependsOn: ["@thomasfosterau/biblio#check", "@reference-manager/dist-consumer#check"],
        cache: false,
      },
    },
  },
});
