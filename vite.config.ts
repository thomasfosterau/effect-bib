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
import * as Arr from "effect/Array";
import * as R from "effect/Record";

/** One rule setting of the `@effect/tsgo` preset. */
type RuleSetting = NonNullable<typeof recommended.rules>[string];

/**
 * The same setting at `error`, its options kept; `off` stays off. (The preset
 * ships its rules as `"warn"` / `"error"` strings.)
 */
const atError = (setting: RuleSetting): RuleSetting =>
  Arr.isArray(setting) ? ["error", ...setting.slice(1)] : setting === "off" ? setting : "error";

/**
 * The `@effect/tsgo` preset with every rule it enables at `error`: lint to
 * zero (#169) keeps no warn tier, so a rule the preset ships at `warn` fails
 * the gate like any other.
 */
const tsgoAtError = { ...recommended, rules: R.map(recommended.rules ?? {}, atError) };

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
    extends: [tsgoAtError, effect.configs.recommended],
    plugins: ["typescript", "unicorn", "oxc", "import", "promise", "vitest", "jsdoc"],
    categories: {
      correctness: "error",
      suspicious: "error",
      perf: "error",
    },
    rules: {
      "eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "eslint/prefer-const": "error",
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
      // The canonical helper-module aliases (`Arr`, `P`, `R`, `Str`, `Eq`,
      // `Bool`; every other module under its full name), at `error` (#167).
      "effect/prefer-namespace-imports": "error",
      // Lint to zero (#169)
      "effect/imperative-loops": "error",

      // No ported-code allowances remain: every preset rule is at its `error`
      // level. `prefer-option-over-null` (#168) and `no-unknown-parameters`
      // (#169) have no exception either: the public decoders take
      // `Schema.Json`, the sanitisers decoded strings and numbers.
      // `_tag` is Effect's discriminant (tagged unions, `Data.TaggedError`).
      "eslint/no-underscore-dangle": ["error", { allow: ["_tag"] }],
      // Flags every spread of `Schema.JsonObject` (a plain-object index
      // signature, never a class instance) in the embedded-metadata reader
      // as a class spread: a false positive with no code-level fix.
      "typescript/no-misused-spread": "off",
      // `@since` and `@category` are the docgen tags every export carries.
      "jsdoc/check-tag-names": ["error", { definedTags: ["since", "category"] }],
      // Vitest's `expect(value, message)` takes a failure message second.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "assert"] }],
      // `@effect/vitest`'s test blocks are test blocks (#190): configuration of
      // what counts as one, not a suppression.
      "vitest/no-standalone-expect": [
        "error",
        { additionalTestBlockFunctions: ["it.effect", "it.live", "it.effect.each"] },
      ],
      // Mirrors `unstableApiUsage: "suggestion"` in tsconfig.base.json: Effect
      // 4 marks most of `effect/http` unstable, so every HttpClient use in
      // `./sources` would warn and bury the rest.
      "effecttsgo/unstable-api-usage": "off",
      // Not in `recommended` (`correctness` has it at `warn`); held at `error`
      // so an `unknown` error channel cannot land (the public
      // `ResolveAddresses` was the last, #136).
      "effecttsgo/any-unknown-in-error-context": "error",
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
      // The consumer fixture stands in for an application: its `provided`
      // export is the entry point that supplies the lookup layer.
      {
        files: ["tests/dist-consumer/**"],
        rules: {
          "effecttsgo/strict-effect-provide": "off",
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
      // Type-level tests: an expect-error directive IS the assertion there —
      // the one place the preset's ban on it does not apply.
      {
        files: ["**/*.types.ts"],
        rules: {
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
      // The whole CI pipeline as one task, the one command
      // .github/workflows/ci.yml runs (`vp run ci`), so a local run and CI are
      // the same thing. The gates of AGENTS.md#verification, in order and
      // fail-fast: format + lint, build, the type gates, the oracle corpora
      // (network, for the BibTeX oracle test), unit tests + coverage, the
      // executed docs examples, and the dependency audit (network).
      ci: {
        command:
          "vp check && vp run -r build && vp run --concurrency-limit 2 check && vp run --filter ./packages/effect-bib oracles:fetch && vp run -r test:coverage && vp run -r docgen && pnpm audit --audit-level high",
        cache: false,
      },
      // The CI typecheck gate, as one task: every package's `check`, plus the
      // dist-consumer check that type-checks a consumer fixture against the
      // EMITTED declarations (the identifier brands must survive declaration
      // emit — a brand that degrades to `string` only shows up there). A pure
      // graph node.
      check: {
        command: "echo 'check: every type gate green'",
        dependsOn: ["@thomasfosterau/effect-bib#check", "@reference-manager/dist-consumer#check"],
        cache: false,
      },
    },
  },
});
