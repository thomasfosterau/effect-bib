/**
 * Citation keys for the writers: a record's own key where it has one,
 * cleaned of the characters a BibTeX key cannot hold, else a generated
 * `authorYEARword` key; a key already taken gets a letter suffix (`a`, `b`,
 * … `z`, `aa`, …), so every entry of one output is distinct.
 *
 * @copyright Thomas Foster
 * @module biblio/write/keys
 * @since 1.0.0
 */

import * as Array from "effect/Array";
import * as HashSet from "effect/HashSet";
import * as MutableHashSet from "effect/MutableHashSet";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as String from "effect/String";
import { type BiblioRecord, type CslName, yearOf } from "../record.ts";
import { stripCslMarkup } from "../render/markup.ts";

/** Characters a BibTeX citation key cannot hold (BibTeX ends a key at them, or LaTeX reads them). */
const KEY_UNSAFE = /[\s,{}()"#%'=\\~]/g;

/** Title words a generated key skips. */
const STOP_WORDS = HashSet.make("a", "an", "the", "on", "of", "and", "in", "to", "for", "at");

/** Lower-case ASCII letters and digits only: marks stripped, everything else dropped. */
const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * A record's own key: its `citation-key`, else a string `id`, cleaned of the
 * characters a key cannot hold; `None` when nothing usable is left.
 *
 * @since 1.0.0
 */
export function ownKey(record: BiblioRecord): Option.Option<string> {
  const candidate = Option.orElse(Option.fromUndefinedOr(record["citation-key"]), () =>
    Option.filter(Option.fromUndefinedOr(record.id), Predicate.isString),
  );
  return Option.filter(
    Option.map(candidate, (key) => key.replace(KEY_UNSAFE, "")),
    String.isNonEmpty,
  );
}

/** The first contributor's surname (a literal name's first word), folded. */
function authorPart(record: BiblioRecord): string {
  const names: readonly CslName[] = record.author ?? record.editor ?? [];
  return Option.match(Array.head(names), {
    onNone: () => "",
    onSome: (name) => fold(name.family ?? name.literal?.split(" ")[0] ?? name.given ?? ""),
  });
}

/** The first significant title word, folded. */
function titleWord(record: BiblioRecord): string {
  const words = stripCslMarkup(record.title ?? "")
    .split(/\s+/)
    .map(fold);
  return Option.getOrElse(
    Array.findFirst(words, (word) => String.isNonEmpty(word) && !HashSet.has(STOP_WORDS, word)),
    () => "",
  );
}

/**
 * A generated key: the first contributor's surname, the year and the first
 * significant title word (`harari2015sapiens`), in lower-case ASCII; `ref`
 * when the record has none of them.
 *
 * @since 1.0.0
 */
function generatedKey(record: BiblioRecord): string {
  const year = yearOf(record.issued);
  const key = `${authorPart(record)}${year === null ? "" : year}${titleWord(record)}`;
  return String.isEmpty(key) ? "ref" : key;
}

/** The `index`th letter suffix: `a` … `z`, then `aa`, `ab`, …. */
function suffix(index: number): string {
  const letter = globalThis.String.fromCharCode(97 + (index % 26));
  return index < 26 ? letter : `${suffix(Math.floor(index / 26) - 1)}${letter}`;
}

/** The first of `key`, `key`+`a`, `key`+`b`, … not yet taken. */
function unused(taken: MutableHashSet.MutableHashSet<string>, key: string, index: number): string {
  if (index > 0 && !MutableHashSet.has(taken, `${key}${suffix(index - 1)}`))
    return `${key}${suffix(index - 1)}`;
  if (index === 0 && !MutableHashSet.has(taken, key)) return key;
  return unused(taken, key, index + 1);
}

/**
 * One distinct citation key per record, in order: the record's own key
 * ({@link ownKey}) when it has one, else a generated one
 * ({@link generatedKey}), with a letter suffix when the key is already taken
 * by an earlier record.
 *
 * @since 1.0.0
 */
export function citationKeys(records: readonly BiblioRecord[]): string[] {
  const taken = MutableHashSet.empty<string>();
  return Array.map(records, (record) => {
    const key = unused(
      taken,
      Option.getOrElse(ownKey(record), () => generatedKey(record)),
      0,
    );
    MutableHashSet.add(taken, key);
    return key;
  });
}
