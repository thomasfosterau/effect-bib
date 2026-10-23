/**
 * Mechanical proof that the entry-point split keeps its promise: the root
 * entry (`.`) resolves `effect` and `@thomasfosterau/effect-parse` (whose
 * own built graph is walked too) and nothing else — never one of the modules formerly under `effect/unstable/*`
 * (`fixtures/forbidden-effect-modules.mjs`)
 * and never a `sources/` module — so a browser bundle that imports it never
 * loads the lookup clients. The `./sources` entry is where
 * `effect/http` is allowed to appear.
 *
 * The property is a packaging commitment, and a comment asserting it would
 * rot within two releases — one `import type` from `./sources/errors.ts`
 * added to `record.ts` is enough to break it silently. So this walks the real
 * import graph instead. Adapted from the effect-jsonapi library's
 * `test/entry-points.test.ts`.
 *
 * @module biblio/tests/entry-points
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as Array from "effect/Array";
import * as Function from "effect/Function";
import * as HashSet from "effect/HashSet";
import * as MutableHashMap from "effect/MutableHashMap";
import * as MutableHashSet from "effect/MutableHashSet";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { expectSome } from "./assert.ts";
import {
  FORBIDDEN_DIRECTORIES,
  FORBIDDEN_ENCODING_MODULES,
  FORBIDDEN_SPECIFIER,
} from "./fixtures/forbidden-effect-modules.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

/**
 * Module specifiers of `file`, read off the AST. Type-only imports count: an
 * `import type … from "effect/http"` emits no runtime edge, but it
 * still makes the published `.d.ts` unresolvable without that surface.
 */
const specifiersOf = (file: string): ReadonlyArray<string> => {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: Array<string> = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

/** Code-unit order, the order a bare `Array.prototype.sort()` gives strings. */
const sorted = (items: Iterable<string>): ReadonlyArray<string> =>
  Array.sortWith(Array.fromIterable(items), Function.identity, Order.String);

const resolveRelative = (from: string, specifier: string): Option.Option<string> => {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base.replace(/\.js$/, ".ts"), base, `${base}.ts`];
  return Array.findFirst(
    candidates,
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
};

interface Graph {
  /** Files reached, relative to `dir`. */
  readonly modules: ReadonlyArray<string>;
  /** Bare specifiers reached, each mapped to the chain of files that reached it. */
  readonly externals: ReadonlyArray<readonly [string, ReadonlyArray<string>]>;
}

/** Walks the transitive import graph from `entry`, recording how each external was reached. */
const graphFrom = (entry: string, dir: string): Graph => {
  const modules = MutableHashSet.empty<string>();
  const externals = MutableHashMap.empty<string, ReadonlyArray<string>>();
  const walk = (file: string, trail: ReadonlyArray<string>): void => {
    if (MutableHashSet.has(modules, file)) return;
    MutableHashSet.add(modules, file);
    const here = [...trail, path.relative(dir, file)];
    Array.forEach(specifiersOf(file), (specifier) => {
      if (!specifier.startsWith(".")) {
        if (!MutableHashMap.has(externals, specifier)) {
          MutableHashMap.set(externals, specifier, here);
        }
        return;
      }
      // An unresolvable relative import is a broken graph, not a pass.
      const resolved = expectSome(
        resolveRelative(file, specifier),
        `a resolution of "${specifier}", imported by ${path.relative(dir, file)}`,
      );
      walk(resolved, here);
    });
  };
  walk(entry, []);
  return {
    modules: sorted(Array.map(Array.fromIterable(modules), (file) => path.relative(dir, file))),
    externals: Array.fromIterable(externals),
  };
};

/** The root entry's one dependency besides `effect`: the BibTeX scanner's combinators (#72). */
const EFFECT_PARSE = "@thomasfosterau/effect-parse";

/** Bare specifiers in `graph` other than `effect` and its modules. */
const nonEffect = (graph: Graph): ReadonlyArray<string> =>
  Array.filter(
    Array.map(graph.externals, ([specifier]) => specifier),
    (specifier) => specifier !== "effect" && !specifier.startsWith("effect/"),
  );

const unstable = (graph: Graph): ReadonlyArray<string> =>
  sorted(
    Array.map(
      Array.filter(graph.externals, ([specifier]) => FORBIDDEN_SPECIFIER.test(specifier)),
      ([specifier, trail]) => `${specifier} via ${trail.join(" -> ")}`,
    ),
  );

describe("root entry point", () => {
  const root = graphFrom(path.join(SRC, "index.ts"), SRC);
  const sources = graphFrom(path.join(SRC, "sources", "index.ts"), SRC);

  it("resolves no formerly-unstable effect surface at all", () => {
    expect(unstable(root)).toEqual([]);
  });

  it("resolves only `effect` modules and effect-parse", () => {
    expect(nonEffect(root).filter((specifier) => specifier !== EFFECT_PARSE)).toEqual([]);
  });

  it("reaches nothing but stable `effect` modules through effect-parse", () => {
    const entry = createRequire(import.meta.url).resolve(EFFECT_PARSE);
    const graph = graphFrom(entry, path.dirname(entry));
    expect(graph.modules.length).toBeGreaterThan(1);
    expect(unstable(graph)).toEqual([]);
    expect(nonEffect(graph)).toEqual([]);
  });

  it("reaches no `sources/` module", () => {
    expect(root.modules.filter((module) => module.startsWith("sources/"))).toEqual([]);
  });

  /**
   * The control. Without it every assertion above could pass because the
   * walker stopped finding imports rather than because the property holds.
   * The sources barrel genuinely does reach `effect/http`, so a
   * walker that cannot see it here cannot be trusted to see it above.
   */
  it("is checked by a walker that does detect the HTTP surface (control: `./sources`)", () => {
    expect(unstable(sources).join("\n")).toContain("effect/http");
    expect(sources.modules.filter((module) => module.startsWith("sources/"))).not.toEqual([]);
  });

  it("exports the pure surface and none of the lookup surface", async () => {
    const index = await import("@thomasfosterau/biblio");
    const names = Record.keys(index);
    expect(names).toContain("BiblioRecord");
    expect(names).toContain("decodeIsbn");
    expect(names).toContain("parseBibliographicFile");
    expect(names).toContain("scoreMatch");
    expect(names).toContain("renderReference");
    expect(names).not.toContain("BiblioLookup");
    expect(names).not.toContain("LookupFailed");
  });
});

describe("sources entry point", () => {
  it("exports the service, its layers, the per-source lookups and the error channel", async () => {
    const sources = await import("@thomasfosterau/biblio/sources");
    expect(sorted(Record.keys(sources))).toEqual([
      "BiblioLookup",
      "CrossrefResponse",
      "InvalidIdentifier",
      "LookupFailed",
      "LookupSource",
      "OpenAlexSearchResponse",
      "OpenAlexWork",
      "OpenLibraryAuthor",
      "OpenLibraryEdition",
      "biblioLookupClientLayer",
      "biblioLookupLayer",
      "lookupCrossrefByDoi",
      "lookupDoiCsl",
      "lookupOpenAlexByDoi",
      "lookupOpenLibraryByIsbn",
      "normaliseCrossrefRecord",
      "normaliseOpenAlexRecord",
      "normaliseOpenLibraryRecord",
      "openLibraryAuthorKeys",
      "openLibraryAuthorName",
      "searchOpenAlexByTitle",
    ]);
  });
});

describe("package exports map", () => {
  // The two exports maps stay raw, so `toEqual` below sees every condition
  // in them rather than only the ones a schema would keep.
  const manifest = Schema.decodeUnknownSync(
    Schema.fromJsonString(
      Schema.Struct({
        exports: Schema.Unknown,
        publishConfig: Schema.Struct({ exports: Schema.Unknown }),
      }),
    ),
  )(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

  it("points the workspace entries at the two source barrels", () => {
    expect(manifest.exports).toEqual({
      ".": "./src/index.ts",
      "./sources": "./src/sources/index.ts",
    });
  });

  it("publishes the same two subpaths from dist/", () => {
    expect(manifest.publishConfig.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./sources": { types: "./dist/sources/index.d.ts", default: "./dist/sources/index.js" },
    });
  });
});

/**
 * `tsc` emits one file per module and only rewrites the `.ts` extensions, so
 * the source graph above is the built graph. This re-checks it on the
 * artifact anyway, because that is what actually ships. The `test:unit` and
 * `test:coverage` tasks depend on `build`, so `vp run` always has `dist/`
 * here. A bare `vp test` may not, and there the cases are reported as
 * skipped rather than silently passing; under `CI` they run regardless, so a
 * missing `dist/` fails instead of skipping (#22).
 */
describe("built artifact", () => {
  const built = path.join(DIST, "index.js");
  const unbuilt = !fs.existsSync(built) && process.env["CI"] === undefined;

  it.skipIf(unbuilt)("ships a root entry that resolves no unstable effect surface", () => {
    expect(unstable(graphFrom(built, DIST))).toEqual([]);
  });

  it.skipIf(unbuilt)("ships declarations for both entry points", () => {
    const missing = Array.filter(
      ["index.js", "index.d.ts", "sources/index.js", "sources/index.d.ts"],
      (file) => !fs.existsSync(path.join(DIST, file)),
    );
    expect(missing, "dist/ files missing").toEqual([]);
  });

  /**
   * The end-to-end statement, and the one that does not depend on the walker
   * above being right: load the built entry in a process where
   * the former `effect/unstable/*` modules (`effect/http`, ...) cannot be resolved at all.
   */
  const loadWithoutUnstable = (entry: string) =>
    spawnSync(
      process.execPath,
      [
        "--import",
        fileURLToPath(new URL("./fixtures/forbid-http-peer.mjs", import.meta.url)),
        "--input-type=module",
        "-e",
        // The entry arrives as an argument, so no path is spliced into the code.
        `await import(process.argv[1]); console.log("LOADED")`,
        entry,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );

  it.skipIf(unbuilt)("loads the root entry with effect/http and its siblings unresolvable", () => {
    const result = loadWithoutUnstable(built);
    expect(`${result.stdout}${result.stderr}`).toContain("LOADED");
    expect(result.status).toBe(0);
  });

  it.skipIf(unbuilt)("is checked by hooks that do block the sources entry (control)", () => {
    const result = loadWithoutUnstable(path.join(DIST, "sources", "index.js"));
    const output = `${result.stdout}${result.stderr}`;
    expect(output).toContain("FORBIDDEN_PEER:effect/http");
    expect(output).not.toContain("LOADED");
    expect(result.status).not.toBe(0);
  });
});

/**
 * The forbidden set is a hand-kept list, so check it against the installed
 * `effect`: every directory of `effect/` except `encoding`, `testing` and
 * `internal` must be on it, and so must every `effect/encoding` module other
 * than the four that were always stable. A new directory in a later rc fails
 * here rather than slipping past the guard.
 */
describe("forbidden effect module list", () => {
  const dist = path.join(
    path.dirname(createRequire(import.meta.url).resolve("effect/package.json")),
    "dist",
  );
  const subdirectories = (dir: string): ReadonlyArray<string> =>
    sorted(
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
  const STABLE_ENCODING = HashSet.make("Base64", "Base64Url", "Hex", "EncodingError", "index");

  it("covers every effect directory except encoding, testing and internal", () => {
    const expected = subdirectories(dist).filter(
      (name) => !["encoding", "testing", "internal"].includes(name),
    );
    expect(sorted(FORBIDDEN_DIRECTORIES)).toEqual(expected);
  });

  it("covers every effect/encoding module that was unstable", () => {
    const expected = sorted(
      fs
        .readdirSync(path.join(dist, "encoding"))
        .filter((name) => name.endsWith(".js") && !name.endsWith(".map"))
        .map((name) => name.replace(/\.js$/, ""))
        .filter((name) => !HashSet.has(STABLE_ENCODING, name)),
    );
    expect(sorted(FORBIDDEN_ENCODING_MODULES)).toEqual(expected);
  });

  it("matches the forbidden modules and leaves the stable ones alone", () => {
    const forbidden = [
      "effect/http",
      "effect/http/HttpClient",
      "effect/http-api/HttpApi",
      "effect/encoding/Yaml",
    ];
    const allowed = [
      "effect",
      "effect/Schema",
      "effect/Option",
      "effect/encoding/Base64",
      "effect/encoding",
      "effect/testing",
      "effect/httpx",
    ];
    expect(Array.filter(forbidden, (specifier) => !FORBIDDEN_SPECIFIER.test(specifier))).toEqual(
      [],
    );
    expect(Array.filter(allowed, (specifier) => FORBIDDEN_SPECIFIER.test(specifier))).toEqual([]);
  });
});
