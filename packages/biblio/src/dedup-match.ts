/**
 * Fuzzy title/author matching for bibliographic dedup (KB-010, #610).
 *
 * Exact-identifier dedup misses a record that arrives without a usable
 * identifier, or with a *different* identifier for the same work (a reprint
 * ISBN, a preprint vs published DOI). This module is the deterministic
 * decision behind a second, fuzzy pass: given an incoming record's title +
 * author names and a candidate's title + author names, it scores their
 * similarity and decides whether they are confidently the **same work**.
 *
 * The decision is intentionally **high-precision**: a true reprint (same
 * title, same authors) matches, but a merely similar-looking different work
 * must **not** be silently merged. Below the threshold the caller treats the
 * incoming record as a distinct work; this module only answers the binary
 * question, not near-miss review.
 *
 * Everything here is **pure and deterministic**: no database, no network.
 * The caller owns any candidate pre-filter (e.g. a trigram similarity
 * probe); this module owns the normalisation, scoring and threshold that
 * turn a candidate into a yes/no.
 *
 * @copyright Thomas Foster
 * @module biblio/dedup-match
 * @since 0.1.0
 */

import * as Array from "effect/Array";
import * as HashSet from "effect/HashSet";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as String from "effect/String";
import { type BiblioRecord, cslNameDisplay } from "./record.ts";

/**
 * Leading articles dropped from a title's token set: they carry no
 * disambiguating signal, and keeping them would sink a genuine match when
 * one source writes "The Hobbit" and another "Hobbit".
 */
const TITLE_STOPWORDS: HashSet.HashSet<string> = HashSet.make("the", "a", "an");

/**
 * Folds a free-text value to a comparison key: strips diacritics
 * (NFKD + combining-mark removal), lower-cases, and reduces every run of
 * non-alphanumeric characters to a single space. So "Lévi-Strauss, Claude"
 * and "levi strauss claude" fold together, and punctuation / casing /
 * accent variation between sources stops mattering.
 *
 * @since 0.1.0
 */
export function normaliseForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The set of significant word tokens in a title — normalised, with the
 * leading-article stopwords dropped. A set (not a list) so token *order*
 * and repetition don't matter ("Rings of the Lord" vs "Lord of the Rings"
 * compare equal), which is the right invariance for title-vs-title dedup.
 *
 * @since 0.1.0
 */
export function titleTokens(title: string): HashSet.HashSet<string> {
  const tokens = normaliseForMatch(title)
    .split(" ")
    .filter((token) => String.isNonEmpty(token) && !HashSet.has(TITLE_STOPWORDS, token));
  return HashSet.fromIterable(tokens);
}

/**
 * The surname used to compare authors across sources that differ on
 * given-name form. Handles **both** common orderings: a
 * "Surname, Given" form (the text before the first comma is the family
 * name) and a "Given Surname" form (the family name is the last token). So
 * "Harari, Yuval Noah", "Yuval Noah Harari", and "Y. N. Harari" all reduce
 * to "harari". Returns `""` for a name that normalises to nothing (filtered
 * out by the caller).
 *
 * @since 0.1.0
 */
export function authorSurname(name: string): string {
  // "Surname, Given" → the family name is everything before the first comma;
  // otherwise the family name is the last token of "Given Surname".
  const commaIndex = name.indexOf(",");
  const familySource = commaIndex >= 0 ? name.slice(0, commaIndex) : name;
  const parts = normaliseForMatch(familySource).split(" ").filter(String.isNonEmpty);
  const family = Array.last(parts);
  return Option.isNone(family) ? "" : family.value;
}

/** Size of the intersection of two token sets, `|A ∩ B|`. */
function intersectionSize(a: HashSet.HashSet<string>, b: HashSet.HashSet<string>): number {
  return Array.reduce(a, 0, (count, token) => (HashSet.has(b, token) ? count + 1 : count));
}

/**
 * Jaccard overlap of two token sets — `|A ∩ B| / |A ∪ B|`. An empty set on
 * either side yields `0`: absence of tokens is treated as no evidence of a
 * match, never as a (vacuous) perfect one.
 */
function jaccard(a: HashSet.HashSet<string>, b: HashSet.HashSet<string>): number {
  if (HashSet.isEmpty(a) || HashSet.isEmpty(b)) return 0;
  const intersection = intersectionSize(a, b);
  return intersection / (HashSet.size(a) + HashSet.size(b) - intersection);
}

/**
 * A record's matchable shape: a title and zero or more author display names.
 *
 * @since 0.1.0
 */
export interface MatchInput {
  readonly title: string;
  readonly authors: readonly string[];
}

/**
 * Projects a CSL-aligned {@link BiblioRecord} onto the minimal
 * {@link MatchInput} the scorer needs — the title and the contributor
 * **display names** derived from the structured CSL names. The scorer
 * stays decoupled from the full record model (and from DB rows, which
 * `ingest.ts` projects the same shape from), so the fuzzy-match path is
 * untouched by record-shape changes beyond how names/titles are extracted.
 *
 * @since 0.1.0
 */
export function recordMatchInput(record: BiblioRecord): MatchInput {
  const authors = Array.filterMap(record.author ?? [], (name): Result.Result<string, void> => {
    const display = cslNameDisplay(name);
    return display === null ? Result.failVoid : Result.succeed(display);
  });
  return { title: record.title ?? "", authors };
}

/**
 * The similarity axes scored for a candidate pair.
 *
 * @since 0.1.0
 */
export interface MatchScore {
  /** Title token-set Jaccard, `0..1`. */
  readonly title: number;
  /**
   * Author surname-set Jaccard, `0..1`, or `Option.none()` when **either**
   * side lists no authors — there is then no author signal to weigh, and the
   * title carries the decision alone (under a stricter bar; see
   * {@link isConfidentMatch}).
   */
  readonly author: Option.Option<number>;
  /**
   * Number of significant title tokens shared by both sides, `|A ∩ B|`. A
   * single shared token (e.g. two unrelated books both titled "It") is not
   * discriminating enough to dedup on the title alone, so the no-author
   * path additionally requires {@link MIN_TITLE_TOKENS_NO_AUTHOR} of these.
   */
  readonly sharedTitleTokens: number;
}

/**
 * Minimum title overlap to dedup when author evidence agrees. High enough
 * that a dropped subtitle or an extra qualifier word does **not** clear it
 * — those are treated as distinct works, not a silent merge.
 */
const TITLE_MATCH_THRESHOLD = 0.9;

/**
 * Stricter title bar applied when there is **no** author signal on one or
 * both sides: with nothing to corroborate the title, only a near-exact
 * title match may auto-dedup.
 */
const TITLE_STRICT_THRESHOLD = 0.95;

/** Minimum author surname overlap required when both sides list authors. */
const AUTHOR_MATCH_THRESHOLD = 0.5;

/**
 * Minimum shared significant title tokens to auto-dedup on the **no-author**
 * path. A one-word title (e.g. "It", "Go", "1984") collides too easily
 * across genuinely different works, and with no author to corroborate it
 * must not silently merge them — so that path demands a multi-token title
 * overlap as well as the strict similarity bar.
 */
const MIN_TITLE_TOKENS_NO_AUTHOR = 2;

/**
 * Scores an incoming record against a candidate on the axes
 * {@link MatchScore} describes. Pure and symmetric.
 *
 * @example
 * ```ts
 * import { isConfidentMatch, scoreMatch } from "@thomasfosterau/biblio"
 *
 * // Leading articles, punctuation and initials fold away before scoring.
 * const score = scoreMatch(
 *   { title: "The Hobbit", authors: ["J. R. R. Tolkien"] },
 *   { title: "Hobbit", authors: ["Tolkien, J.R.R."] },
 * )
 * console.log(score.title, score.sharedTitleTokens)
 * // → 1 1
 * console.log(isConfidentMatch(score))
 * // → true
 * ```
 *
 * @since 0.1.0
 */
export function scoreMatch(incoming: MatchInput, candidate: MatchInput): MatchScore {
  const incomingTitleTokens = titleTokens(incoming.title);
  const candidateTitleTokens = titleTokens(candidate.title);
  const title = jaccard(incomingTitleTokens, candidateTitleTokens);
  const sharedTitleTokens = intersectionSize(incomingTitleTokens, candidateTitleTokens);

  const incomingSurnames = HashSet.fromIterable(
    incoming.authors.map(authorSurname).filter(String.isNonEmpty),
  );
  const candidateSurnames = HashSet.fromIterable(
    candidate.authors.map(authorSurname).filter(String.isNonEmpty),
  );
  const author =
    HashSet.isEmpty(incomingSurnames) || HashSet.isEmpty(candidateSurnames)
      ? Option.none<number>()
      : Option.some(jaccard(incomingSurnames, candidateSurnames));

  return { title, author, sharedTitleTokens };
}

/**
 * The auto-dedup decision: `true` only when the pair is confidently the
 * **same work**. With author evidence on both sides, the title must clear
 * {@link TITLE_MATCH_THRESHOLD} **and** the authors must agree to at least
 * {@link AUTHOR_MATCH_THRESHOLD}. With **no** author signal, the title alone
 * must clear the stricter {@link TITLE_STRICT_THRESHOLD} **and** share at
 * least {@link MIN_TITLE_TOKENS_NO_AUTHOR} significant tokens — so a bare,
 * uncorroborated one-word title never collapses two distinct works. Anything
 * below is not a confident match; treat the incoming record as a distinct work.
 *
 * @since 0.1.0
 */
export function isConfidentMatch(score: MatchScore): boolean {
  if (Option.isNone(score.author)) {
    return (
      score.title >= TITLE_STRICT_THRESHOLD && score.sharedTitleTokens >= MIN_TITLE_TOKENS_NO_AUTHOR
    );
  }
  return score.title >= TITLE_MATCH_THRESHOLD && score.author.value >= AUTHOR_MATCH_THRESHOLD;
}

/**
 * A single rank value over a {@link MatchScore} so the caller can pick the
 * **best** among several confident candidates: the title dominates, the
 * author breaks ties, and a no-author-signal pair ranks on its title alone.
 *
 * @since 0.1.0
 */
export function matchConfidence(score: MatchScore): number {
  return Option.isNone(score.author) ? score.title : score.title * 0.7 + score.author.value * 0.3;
}

/* oxlint-disable effect/prefer-option-over-null -- cross-slice: apps/api consumes the plain nullable */
/**
 * Picks the single best **confident** same-work match for `incoming` from a
 * candidate set — the highest {@link matchConfidence} among those that pass
 * {@link isConfidentMatch} — or `null` when none is confident. Pass
 * pre-filtered candidates (e.g. by title similarity, with their authors).
 * Pure and deterministic.
 *
 * Returns `null` rather than an `Option` by design: the plain-nullable
 * shape is a stable contract with existing consumers, not a pending
 * migration.
 *
 * @example
 * ```ts
 * import { bestConfidentMatch } from "@thomasfosterau/biblio"
 *
 * const incoming = { title: "The Hobbit", authors: ["J. R. R. Tolkien"] }
 * const best = bestConfidentMatch(incoming, [
 *   { id: 1, title: "The Silmarillion", authors: ["Tolkien"] },
 *   { id: 2, title: "Hobbit", authors: ["Tolkien, J.R.R."] },
 * ])
 * console.log(best?.id)
 * // → 2
 * ```
 *
 * @since 0.1.0
 */
export function bestConfidentMatch<T extends MatchInput>(
  incoming: MatchInput,
  candidates: readonly T[],
): T | null {
  /* oxlint-enable effect/prefer-option-over-null */
  type Best = Option.Option<{ readonly candidate: T; readonly confidence: number }>;
  const best = Array.reduce<T, Best>(candidates, Option.none(), (acc, candidate) => {
    const score = scoreMatch(incoming, candidate);
    if (!isConfidentMatch(score)) return acc;
    const confidence = matchConfidence(score);
    return Option.isNone(acc) || confidence > acc.value.confidence
      ? Option.some({ candidate, confidence })
      : acc;
  });
  return Option.isNone(best) ? null : best.value.candidate;
}
