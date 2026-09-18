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

      // ---- Effect preset: ported-code allowances ---------------------------
      // The modules under packages/*/src are ports of code the website
      // application carries today, which predates the Effect oxlint preset.
      // The rules below sit at `warn` so the verbatim ports stay committable
      // while each site stays reported; a new site is a defect, not headroom.
      // `prefer-option-over-null` is NOT here: it stays at `error`, because
      // every deliberate `null` on a cross-package contract (`isbnForms`,
      // `parsePersonName`, `cslNameDisplay`, `yearOf`) carries a written
      // justification in an `oxlint-disable` block, and that discipline is
      // the point.
      "effect/imperative-loops": "warn",
      "effect/avoid-native-object-helpers": "warn",
      "effect/avoid-non-null-assertion": "warn",
      "effect/avoid-any": "warn",
      "effect/avoid-untagged-errors": "warn",
      "effect/avoid-direct-json": "warn",
      "effect/prefer-arr-match": "warn",
      "effect/no-length-comparison": "warn",
      "effect/prefer-arr-sort": "warn",
      "effect/avoid-try-catch": "warn",
      "effect/yield-in-for-loop": "warn",
      "effect/prefer-effect-is": "warn",
      "effect/avoid-expect-in-if": "warn",
      "effect/effect-run-in-body": "warn",
      "effect/prefer-effect-fn": "warn",
      "effect/avoid-direct-tag-checks": "warn",
      "effect/avoid-option-getorthrow": "warn",
      "effect/no-barrel-imports": "warn",
      "effect/throw-in-effect-gen": "warn",
      // Rules the preset gained after the website copy was last linted
      // (plugin 0.5): the lenient upstream-response decoders take `unknown`
      // by design (`no-unknown-parameters` / `no-unknown-returns`), the CSL
      // vocabulary maps are open dictionaries on purpose
      // (`no-known-value-widening`), the optional-CSL-key spreads are how
      // `exactOptionalPropertyTypes` records omit a key
      // (`no-conditional-empty-object-spread`), and the narrowings on
      // untrusted JSON carry their reasoning in prose rather than a
      // `SAFETY:` marker (`require-safety-comment-for-type-assertion`).
      "effect/no-conditional-empty-object-spread": "warn",
      "effect/no-unknown-parameters": "warn",
      "effect/no-unknown-returns": "warn",
      "effect/no-known-value-widening": "warn",
      "effect/no-service-constructor-imports": "warn",
      "effect/require-safety-comment-for-type-assertion": "warn",
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
      // graph test walks the source tree with `node:fs` for the same reason.
      {
        files: [
          "**/vite.config.ts",
          "**/vitest.config.ts",
          "**/tests/entry-points.test.ts",
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
