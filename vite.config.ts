import { defineConfig } from "vite-plus";
import { recommended } from "@effect/tsgo/oxlint-presets";
import effect from "@enfect/oxlint";
import * as Arr from "effect/Array";
import * as R from "effect/Record";

type RuleSetting = NonNullable<typeof recommended.rules>[string];

const atError = (setting: RuleSetting): RuleSetting =>
  Arr.isArray(setting) ? ["error", ...setting.slice(1)] : setting === "off" ? setting : "error";

// The `@effect/tsgo` preset with every enabled rule at `error`: no warn tier.
const tsgoAtError = { ...recommended, rules: R.map(recommended.rules ?? {}, atError) };

export default defineConfig({
  // Format with fixes, then lint without: a type-aware autofix at commit time
  // would make the commit differ from the tree that was verified.
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
      // `Buffer` is typed `any` wherever @cloudflare/workers-types is loaded.
      "eslint/no-restricted-globals": [
        "error",
        {
          name: "Buffer",
          message:
            "The `Buffer` global is typed `any` wherever @cloudflare/workers-types is loaded. Use Uint8Array/DataView.",
        },
      ],
      "effect/prefer-namespace-imports": "error",
      "effect/imperative-loops": "error",
      // `_tag` is Effect's discriminant.
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
      // `@effect/vitest`'s test blocks.
      "vitest/no-standalone-expect": [
        "error",
        { additionalTestBlockFunctions: ["it.effect", "it.live", "it.effect.each"] },
      ],
      // Effect 4 marks most of `effect/http` unstable; `./sources` is built on it.
      "effecttsgo/unstable-api-usage": "off",
      // Not in `recommended`: keeps an `unknown` error channel from landing.
      "effecttsgo/any-unknown-in-error-context": "error",
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    overrides: [
      // Run in bare Node outside any Effect runtime: `process.env` and
      // `node:*` are the only options there.
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
    // `typeCheck` stays off: vite-plus 1.7.0's tsrs reports every Effect
    // language-service warning as an error, which
    // `ignoreEffectWarningsInTscExitCode` can't relax and no override can
    // scope. `vp run check` is the type gate.
    options: {
      typeAware: true,
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
      // Everything CI runs, in order and fail-fast.
      ci: {
        command:
          "vp check && vp run -r build && vp run --concurrency-limit 2 check && vp run --filter ./packages/effect-bib oracles:fetch && vp run -r test:coverage && vp run -r docgen && pnpm audit --audit-level high",
        cache: false,
      },
      // Every package's `check`, including the dist-consumer check of the
      // emitted declarations.
      check: {
        command: "echo 'check: every type gate green'",
        dependsOn: ["@thomasfosterau/effect-bib#check", "@reference-manager/dist-consumer#check"],
        cache: false,
      },
      // The release job's publish script (.github/workflows/release.yml): pnpm
      // publishes each public package whose version isn't on npm yet, under
      // OIDC trusted publishing; then `changeset git-tag` tags each untagged
      // version and reports the tags to `changesets/action` through
      // `CHANGESETS_OUTPUT`, which pushes them and creates the GitHub releases.
      // A failed publish stops before tagging; a re-run publishes only what is
      // missing. Uncached, so it sees the job's full environment.
      release: {
        command: [
          "vp pm publish -r --access public --no-git-checks -- --ignore-scripts",
          "changeset git-tag",
        ],
        dependsOn: ["@thomasfosterau/effect-bib#build"],
        cache: false,
      },
      // What `release` would publish, without publishing or tagging.
      "release:dry-run": {
        command: "vp pm publish -r --access public --dry-run --no-git-checks -- --ignore-scripts",
        dependsOn: ["@thomasfosterau/effect-bib#build"],
        cache: false,
      },
      fallow: {
        command: "vp exec fallow --summary",
        cache: false,
      },
      // The pre-commit gate: fails only on findings this change introduces.
      // Reads the coverage map `test:coverage` writes (.fallowrc.json).
      "fallow:audit": {
        command: "vp exec fallow audit --base origin/trunk --quiet",
        dependsOn: ["@thomasfosterau/effect-bib#test:coverage"],
        cache: false,
      },
    },
  },
});
