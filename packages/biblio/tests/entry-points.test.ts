/**
 * Mechanical proof that the entry-point split keeps its promise: the root
 * entry (`.`) resolves `effect` and nothing else — never one of the modules formerly under `effect/unstable/*`
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
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
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

// oxlint-disable-next-line effect/prefer-option-over-null -- feeds `expect(...).toBeDefined()`, whose message names the broken import
const resolveRelative = (from: string, specifier: string): string | undefined => {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base.replace(/\.js$/, ".ts"), base, `${base}.ts`];
  return candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
  );
};

interface Graph {
  /** Files reached, relative to `dir`. */
  readonly modules: ReadonlyArray<string>;
  /** Bare specifiers reached, each mapped to the chain of files that reached it. */
  readonly externals: ReadonlyMap<string, ReadonlyArray<string>>;
}

/** Walks the transitive import graph from `entry`, recording how each external was reached. */
const graphFrom = (entry: string, dir: string): Graph => {
  const modules = new Set<string>();
  const externals = new Map<string, ReadonlyArray<string>>();
  const walk = (file: string, trail: ReadonlyArray<string>): void => {
    if (modules.has(file)) return;
    modules.add(file);
    const here = [...trail, path.relative(dir, file)];
    for (const specifier of specifiersOf(file)) {
      if (specifier.startsWith(".")) {
        const resolved = resolveRelative(file, specifier);
        // An unresolvable relative import is a broken graph, not a pass.
        expect(
          resolved,
          `${path.relative(dir, file)} imports unresolvable "${specifier}"`,
        ).toBeDefined();
        if (resolved !== undefined) walk(resolved, here);
      } else if (!externals.has(specifier)) {
        externals.set(specifier, here);
      }
    }
  };
  walk(entry, []);
  return {
    modules: [...modules].map((file) => path.relative(dir, file)).sort(),
    externals,
  };
};

const unstable = (graph: Graph): ReadonlyArray<string> =>
  [...graph.externals.entries()]
    .filter(([specifier]) => FORBIDDEN_SPECIFIER.test(specifier))
    .map(([specifier, trail]) => `${specifier} via ${trail.join(" -> ")}`)
    .sort();

describe("root entry point", () => {
  const root = graphFrom(path.join(SRC, "index.ts"), SRC);
  const sources = graphFrom(path.join(SRC, "sources", "index.ts"), SRC);

  it("resolves no formerly-unstable effect surface at all", () => {
    expect(unstable(root)).toEqual([]);
  });

  it("resolves only `effect` modules", () => {
    const foreign = [...root.externals.keys()].filter(
      (specifier) => specifier !== "effect" && !specifier.startsWith("effect/"),
    );
    expect(foreign).toEqual([]);
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
    const names = Object.keys(index);
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
    expect(Object.keys(sources).sort()).toEqual([
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
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    exports: Record<string, string>;
    publishConfig: { exports: Record<string, { types: string; default: string }> };
  };

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
 * artifact anyway, because that is what actually ships. CI builds before it
 * tests; a bare `vp run test:unit` may not have, so the assertions are
 * reported as skipped rather than silently passing when `dist/` is absent.
 */
describe("built artifact", () => {
  const built = path.join(DIST, "index.js");
  const hasDist = fs.existsSync(built);

  it.skipIf(!hasDist)("ships a root entry that resolves no unstable effect surface", () => {
    expect(unstable(graphFrom(built, DIST))).toEqual([]);
  });

  it.skipIf(!hasDist)("ships declarations for both entry points", () => {
    for (const file of ["index.js", "index.d.ts", "sources/index.js", "sources/index.d.ts"]) {
      expect(fs.existsSync(path.join(DIST, file)), `dist/${file} missing`).toBe(true);
    }
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
        `await import(${JSON.stringify(entry)}); console.log("LOADED")`,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );

  it.skipIf(!hasDist)("loads the root entry with effect/http and its siblings unresolvable", () => {
    const result = loadWithoutUnstable(built);
    expect(`${result.stdout}${result.stderr}`).toContain("LOADED");
    expect(result.status).toBe(0);
  });

  it.skipIf(!hasDist)("is checked by hooks that do block the sources entry (control)", () => {
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
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  const STABLE_ENCODING = new Set(["Base64", "Base64Url", "Hex", "EncodingError", "index"]);

  it("covers every effect directory except encoding, testing and internal", () => {
    const expected = subdirectories(dist).filter(
      (name) => !["encoding", "testing", "internal"].includes(name),
    );
    expect([...FORBIDDEN_DIRECTORIES].sort()).toEqual(expected);
  });

  it("covers every effect/encoding module that was unstable", () => {
    const expected = fs
      .readdirSync(path.join(dist, "encoding"))
      .filter((name) => name.endsWith(".js") && !name.endsWith(".map"))
      .map((name) => name.replace(/\.js$/, ""))
      .filter((name) => !STABLE_ENCODING.has(name))
      .sort();
    expect([...FORBIDDEN_ENCODING_MODULES].sort()).toEqual(expected);
  });

  it("matches the forbidden modules and leaves the stable ones alone", () => {
    for (const specifier of [
      "effect/http",
      "effect/http/HttpClient",
      "effect/http-api/HttpApi",
      "effect/encoding/Yaml",
    ]) {
      expect(FORBIDDEN_SPECIFIER.test(specifier), specifier).toBe(true);
    }
    for (const specifier of [
      "effect",
      "effect/Schema",
      "effect/Option",
      "effect/encoding/Base64",
      "effect/encoding",
      "effect/testing",
      "effect/httpx",
    ]) {
      expect(FORBIDDEN_SPECIFIER.test(specifier), specifier).toBe(false);
    }
  });
});
