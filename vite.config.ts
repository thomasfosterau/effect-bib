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
import effect from "@enfect/oxlint";

export default defineConfig({
  // Staged-file checks run by `vp staged` (pre-commit): format with fixes,
  // then lint WITHOUT fixes. Lint is type-aware, and `vp check --fix` would
  // silently apply the type-aware rules' autofixes (warn-level ones included)
  // to the staged files at commit time, so the commit would differ from the
  // tree that was verified. `--no-error-on-unmatched-pattern` lets a commit
  // that stages only files lint never reads (Markdown, JSON, CSS) pass.
  staged: {
    "*.{js,ts,css,json,md}": [
      "vp check --fix --no-lint",
      "vp check --no-fmt --no-error-on-unmatched-pattern",
    ],
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
    plugins: ["typescript", "unicorn", "oxc", "import", "promise", "vitest", "jsdoc"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
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
      // `_tag` is Effect's discriminant (tagged unions, `Data.TaggedError`).
      "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
      // The library builds immutable values (readonly records and arrays): a
      // fresh spread inside `map` / `flatMap` is the point, not a missed
      // in-place mutation, and every input is bounded (`MAX_*`).
      "oxc/no-map-spread": "off",
      // Flags every spread of `Schema.JsonObject` (a plain-object index
      // signature, never a class instance) in the embedded-metadata reader
      // as a class spread: a false positive with no code-level fix.
      "typescript/no-misused-spread": "off",
      // `@since` and `@category` are the docgen tags every export carries.
      "jsdoc/check-tag-names": ["error", { definedTags: ["since", "category"] }],
      // Vitest's `expect(value, message)` takes a failure message second.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      // The suite's assertion helpers (tests/effect.ts) assert on the exit.
      "vitest/expect-expect": [
        "error",
        { assertFunctionNames: ["expect", "assert", "expectFailureInstanceOf"] },
      ],
      // Mirrors `unstableApiUsage: "suggestion"` in tsconfig.base.json: Effect
      // 4 marks most of `effect/http` unstable, so every HttpClient use in
      // `./sources` would warn and bury the rest.
      "effecttsgo/unstable-api-usage": "off",
      // 1 site, follow-up #136: the public `ResolveAddresses` callback
      // (`./sources`) declares its error `unknown` because a caller's
      // resolver can fail with anything; the request policy only reads the
      // failure as "did not resolve". Narrowing it changes a published type.
      "effecttsgo/any-unknown-in-error-context": "warn",
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
          "effect/use-filesystem-service": "off",
          "effect/use-path-service": "off",
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
      // Tests are the program's entry points: they provide their layers per
      // case (`Effect.provide`), keep each helper next to the cases it serves
      // rather than hoisting it out of the `describe` it reads as part of,
      // and cast a deliberately hostile input past the types to prove the
      // runtime handles it.
      {
        files: ["packages/biblio/tests/**", "tests/dist-consumer/**"],
        rules: {
          "effecttsgo/strict-effect-provide": "off",
          "unicorn/consistent-function-scoping": "off",
          "typescript/no-unsafe-type-assertion": "off",
        },
      },
      // The type-equality idiom `(<X>() => X extends A ? 1 : 2) extends …`
      // needs its single-use type parameter: that is how it compares types.
      {
        files: ["**/*.types.ts", "tests/dist-consumer/src/*.ts"],
        rules: {
          "typescript/no-unnecessary-type-parameters": "off",
        },
      },
      // Config comments describe task wiring, not commented-out tests.
      {
        files: ["**/vite.config.ts"],
        rules: {
          "vitest/no-commented-out-tests": "off",
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
    // Type-aware linting through oxlint-tsgolint (bundled with Vite+, patched
    // by `effect-tsgo patch --oxlint`), with `typeCheck` reporting TypeScript
    // diagnostics too. tsgolint reads each file's nearest tsconfig.json; the
    // package's tsconfig.json covers `src/` and `tests/` already. The `check`
    // tasks stay the type gate of record (they also check the emitted
    // declarations).
    options: {
      typeAware: true,
      typeCheck: true,
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
