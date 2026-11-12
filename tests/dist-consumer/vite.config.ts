import { defineConfig } from "vite-plus";

/**
 * Fails the check when the emitted entry declarations that tsconfig.json's
 * `paths` point at are absent. Without them TypeScript falls back to normal
 * resolution, reaches the workspace link to `packages/effect-bib` and its
 * `exports` into `src/`, and passes against the sources instead of the
 * declarations (#22).
 */
const dist = "../../packages/effect-bib/dist";
const assertEmitted =
  `test -f ${dist}/index.d.ts && test -f ${dist}/record/index.d.ts && ` +
  `test -f ${dist}/sources/index.d.ts || ` +
  `{ echo "dist-consumer: ${dist} has no entry declarations; run vp run @thomasfosterau/effect-bib#build" >&2; exit 1; }`;

export default defineConfig({
  run: {
    tasks: {
      // Type-checks the emitted declarations, after a fresh build. The edge
      // names the package outright: this package declares no dependency on
      // the library, since tsconfig.json's `paths` is the whole resolution, so a
      // `{ task: "build", from: "dependencies" }` edge would match nothing.
      check: {
        command: `${assertEmitted}; tsc -p tsconfig.json`,
        dependsOn: ["@thomasfosterau/effect-bib#build"],
        cache: {
          input: [
            { auto: true },
            "!node_modules/**",
            { pattern: "packages/*/dist/**", base: "workspace" as const },
          ],
          output: [],
        },
      },
    },
  },
});
