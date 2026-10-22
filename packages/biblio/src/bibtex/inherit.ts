/**
 * BibLaTeX data inheritance: an entry's `xdata` sources and its `crossref`
 * parent fill the fields it lacks. `crossref` follows BibLaTeX's default
 * inheritance rules, so a parent book's `title` becomes an `inbook`
 * child's `booktitle`, a multi-volume work's `title` becomes `maintitle`,
 * and a periodical's `title` becomes an article's `journaltitle`. `xref`
 * declares a relation without inheriting anything, as in BibLaTeX, and is
 * kept as an ordinary field.
 *
 * @copyright Thomas Foster
 * @module biblio/bibtex/inherit
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as HashMap from "effect/HashMap";
import * as HashSet from "effect/HashSet";
import * as MutableHashMap from "effect/MutableHashMap";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as String from "effect/String";
import type { BibtexEntry } from "./scan.ts";

/** The longest `crossref` / `xdata` chain followed; a longer one stops there. */
const MAX_INHERITANCE_DEPTH = 8;

/** The most `xdata` sources one entry reads. */
const MAX_XDATA_SOURCES = 32;

/** Entry types that hold shared data for others, not references of their own. */
const DATA_ONLY_KINDS = HashSet.make("xdata", "set");

/** Fields no entry inherits (BibLaTeX's `* → *` rule, plus the inheritance links themselves). */
const NEVER_INHERITED = HashSet.make(
  "ids",
  "crossref",
  "xref",
  "xdata",
  "entryset",
  "entrysubtype",
  "execute",
  "label",
  "options",
  "presort",
  "related",
  "relatedoptions",
  "relatedstring",
  "relatedtype",
  "shorthand",
  "shorthandintro",
  "sortkey",
);

/** A parent's title fields renamed for its child, with the short and sort titles not inherited. */
const titleFields = (prefix: string): ReadonlyArray<readonly [string, readonly string[]]> => [
  ["title", [`${prefix}title`]],
  ["subtitle", [`${prefix}subtitle`]],
  ["titleaddon", [`${prefix}titleaddon`]],
  ["shorttitle", []],
  ["sorttitle", []],
  ["indextitle", []],
  ["indexsorttitle", []],
];

/** One BibLaTeX inheritance rule: for these parent and child types, these fields map to these targets. */
interface InheritanceRule {
  readonly parents: readonly string[];
  readonly children: readonly string[];
  readonly fields: HashMap.HashMap<string, readonly string[]>;
}

const rule = (
  parents: readonly string[],
  children: readonly string[],
  fields: ReadonlyArray<readonly [string, readonly string[]]>,
): InheritanceRule => ({ parents, children, fields: HashMap.fromIterable(fields) });

/** BibLaTeX's default inheritance setup (biblatex manual, appendix B). */
const RULES: readonly InheritanceRule[] = [
  rule(
    ["mvbook", "book"],
    ["inbook", "bookinbook", "suppbook"],
    [["author", ["author", "bookauthor"]]],
  ),
  rule(["mvbook"], ["book", "inbook", "bookinbook", "suppbook"], titleFields("main")),
  rule(
    ["mvcollection", "mvreference"],
    ["collection", "reference", "incollection", "inreference", "suppcollection"],
    titleFields("main"),
  ),
  rule(["mvproceedings"], ["proceedings", "inproceedings", "conference"], titleFields("main")),
  rule(["book"], ["inbook", "bookinbook", "suppbook"], titleFields("book")),
  rule(
    ["collection", "reference"],
    ["incollection", "inreference", "suppcollection"],
    titleFields("book"),
  ),
  rule(["proceedings"], ["inproceedings", "conference"], titleFields("book")),
  rule(
    ["periodical"],
    ["article", "suppperiodical"],
    [
      ["title", ["journaltitle"]],
      ["subtitle", ["journalsubtitle"]],
      ["shorttitle", []],
      ["sorttitle", []],
      ["indextitle", []],
      ["indexsorttitle", []],
    ],
  ),
];

/** The child fields a parent's field fills under the rules for this pair of types. */
function targetsOf(parentKind: string, childKind: string, field: string): readonly string[] {
  if (HashSet.has(NEVER_INHERITED, field)) return [];
  const mapped = Option.flatMap(
    Array.findFirst(
      RULES,
      (candidate) =>
        candidate.parents.includes(parentKind) &&
        candidate.children.includes(childKind) &&
        HashMap.has(candidate.fields, field),
    ),
    (candidate) => HashMap.get(candidate.fields, field),
  );
  return Option.getOrElse(mapped, () => [field]);
}

/** Fills the fields `child` lacks from `parent`, renaming each by `targets`. */
function inherit(
  child: HashMap.HashMap<string, string>,
  parent: HashMap.HashMap<string, string>,
  targets: (field: string) => readonly string[],
): HashMap.HashMap<string, string> {
  return HashMap.reduce(parent, child, (fields, value, field) =>
    Array.reduce(targets(field), fields, (acc, target) =>
      HashMap.has(acc, target) ? acc : HashMap.set(acc, target, value),
    ),
  );
}

/** The keys a `crossref` / `xdata` value names: comma-separated, lower-cased. */
function linkedKeys(value: Option.Option<string>): readonly string[] {
  return Option.match(value, {
    onNone: () => [],
    onSome: (text) =>
      text
        .split(",")
        .map((key) => key.trim().toLowerCase())
        .filter(String.isNonEmpty)
        .slice(0, MAX_XDATA_SOURCES),
  });
}

/** The resolution state: entries by lower-cased key, and fields already resolved. */
interface Resolver {
  readonly byKey: HashMap.HashMap<string, BibtexEntry>;
  readonly resolved: MutableHashMap.MutableHashMap<string, HashMap.HashMap<string, string>>;
}

/**
 * The fields of the entry under `key`, with its own `xdata` and `crossref`
 * resolved; `None` for an unknown key, a cycle, or a chain past
 * {@link MAX_INHERITANCE_DEPTH}.
 */
function resolveKey(
  resolver: Resolver,
  key: string,
  visiting: HashSet.HashSet<string>,
): Option.Option<{ readonly kind: string; readonly fields: HashMap.HashMap<string, string> }> {
  if (HashSet.has(visiting, key) || HashSet.size(visiting) >= MAX_INHERITANCE_DEPTH) {
    return Option.none();
  }
  return Option.map(HashMap.get(resolver.byKey, key), (entry) => {
    const cached = MutableHashMap.get(resolver.resolved, key);
    if (Option.isSome(cached)) return { kind: entry.kind, fields: cached.value };
    const fields = resolveFields(resolver, entry, HashSet.add(visiting, key));
    MutableHashMap.set(resolver.resolved, key, fields);
    return { kind: entry.kind, fields };
  });
}

/** An entry's fields with its `xdata` sources, then its `crossref` parent, filled in. */
function resolveFields(
  resolver: Resolver,
  entry: BibtexEntry,
  visiting: HashSet.HashSet<string>,
): HashMap.HashMap<string, string> {
  const withData = Array.reduce(
    linkedKeys(HashMap.get(entry.fields, "xdata")),
    entry.fields,
    (fields, key) =>
      Option.match(resolveKey(resolver, key, visiting), {
        onNone: () => fields,
        onSome: (source) =>
          inherit(fields, source.fields, (field) =>
            HashSet.has(NEVER_INHERITED, field) ? [] : [field],
          ),
      }),
  );
  const parentKey = Array.head(linkedKeys(HashMap.get(entry.fields, "crossref")));
  const withParent = Option.match(
    Option.flatMap(parentKey, (key) => resolveKey(resolver, key, visiting)),
    {
      onNone: () => withData,
      onSome: (parent) =>
        inherit(withData, parent.fields, (field) => targetsOf(parent.kind, entry.kind, field)),
    },
  );
  return HashMap.remove(HashMap.remove(withParent, "xdata"), "crossref");
}

/** An entry with its resolved fields, marking those it did not have itself. */
function withInherited(entry: BibtexEntry, fields: HashMap.HashMap<string, string>): BibtexEntry {
  const inherited = HashSet.fromIterable(
    Array.filter(
      Array.fromIterable(HashMap.keys(fields)),
      (key) => !HashMap.has(entry.fields, key),
    ),
  );
  return { ...entry, fields, inherited };
}

/**
 * Resolves `xdata` and `crossref` inheritance across a document's entries
 * and drops the data-only entries (`@xdata`, `@set`). Keys match case-
 * insensitively; the first entry with a key wins; a missing parent, a cycle
 * or an over-long chain leaves the entry with its own fields.
 *
 * @since 0.1.0
 */
export function resolveInheritance(entries: readonly BibtexEntry[]): BibtexEntry[] {
  const byKey = Array.reduce(entries, HashMap.empty<string, BibtexEntry>(), (map, entry) => {
    const key = entry.key.toLowerCase();
    return HashMap.has(map, key) ? map : HashMap.set(map, key, entry);
  });
  const resolver: Resolver = { byKey, resolved: MutableHashMap.empty() };
  return Array.filterMap(entries, (entry): Result.Result<BibtexEntry, void> =>
    HashSet.has(DATA_ONLY_KINDS, entry.kind)
      ? Result.failVoid
      : Result.succeed(
          withInherited(
            entry,
            resolveFields(resolver, entry, HashSet.make(entry.key.toLowerCase())),
          ),
        ),
  );
}
