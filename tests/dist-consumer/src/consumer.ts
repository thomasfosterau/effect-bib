/**
 * A consumer's view of both entry points through their EMITTED
 * declarations (`paths` in tsconfig.json points the package names at
 * `dist/**\/*.d.ts`). Each block exercises the types a real consumer depends
 * on, so a declaration that degrades — a brand that emits as `string`, a
 * service whose shape emits as `any` — fails here rather than in an
 * application. Never executed; type-checked only.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { HttpClient } from "effect/http";
import {
  apaStyle,
  type Arxiv,
  type BiblioRecord,
  type EmbeddedMetadata,
  bestConfidentMatch,
  type CslItemType,
  type CslName,
  type CslDate,
  type Doi,
  decodeArxiv,
  decodeDoi,
  decodeIsbn,
  decodePmcid,
  decodePmid,
  fromCslJson,
  type Isbn,
  isbnForms,
  type MatchInput,
  parseBibliographicFile,
  parseCslMarkup,
  type ParseMode,
  type ParseOptions,
  type ParseOutcome,
  type Pmcid,
  type Pmid,
  recordMatchInput,
  type RecordLimits,
  renderBibliography,
  renderReference,
  type RichText,
  scoreMatch,
  type SkipReason,
  type SourcePosition,
  toCslJson,
  vancouverStyle,
} from "@thomasfosterau/biblio";
import {
  BiblioLookup,
  biblioLookupClientLayer,
  biblioLookupLayer,
  type BiblioLookupOptions,
  InvalidIdentifier,
  type LookupContact,
  type LookupError,
  LookupFailed,
  lookupCrossrefByDoi,
  RefusedUrl,
  type ResolveAddresses,
} from "@thomasfosterau/biblio/sources";

/** A compile-time assertion: `T` must be exactly `true`. */
type Assert<T extends true> = T;
type Equals<A, B> =
  (<X>() => X extends A ? 1 : 2) extends <X>() => X extends B ? 1 : 2 ? true : false;
type Not<T extends boolean> = T extends true ? false : true;

declare const raw: string;
declare const client: HttpClient.HttpClient;

// ── identifiers ───────────────────────────────────────────────────────────

export const isbn: Option.Option<Isbn> = decodeIsbn(raw);
export const doi: Option.Option<Doi> = decodeDoi(raw);
export const pmid: Option.Option<Pmid> = decodePmid(raw);
export const pmcid: Option.Option<Pmcid> = decodePmcid(raw);
export const arxiv: Option.Option<Arxiv> = decodeArxiv(raw);
export const forms = Option.map(isbn, isbnForms);

// ── record ────────────────────────────────────────────────────────────────

export const record: BiblioRecord = fromCslJson({ type: "book", title: "Sapiens" });
export const limited: BiblioRecord = fromCslJson({ type: "book" }, { maxAuthors: 500 });
export const csl = toCslJson(record);
type IdentifierSlot = BiblioRecord["identifiers"]["isbn"];
export const markup: RichText = parseCslMarkup("<i>Sapiens</i>");

// ── parse ─────────────────────────────────────────────────────────────────

export const outcomes: ParseOutcome[] = parseBibliographicFile("", "bibtex");
export const lenient: ParseOutcome[] = parseBibliographicFile("", "bibtex", {
  mode: "lenient",
  maxRecords: 10_000,
  maxInputLength: 16_000_000,
  maxFieldLength: 20_000,
  maxAuthors: 1_000,
});

// ── dedup ─────────────────────────────────────────────────────────────────

export const input: MatchInput = recordMatchInput(record);
export const score = scoreMatch(input, input);
export const best = bestConfidentMatch(input, [{ ...input, id: 1 }]);

// ── render ────────────────────────────────────────────────────────────────

export const reference: string = renderReference(record, { style: apaStyle });
export const bibliography = renderBibliography([record], { style: vancouverStyle });

// ── sources ───────────────────────────────────────────────────────────────

export const program = BiblioLookup.use((lookup) => lookup.byIsbnRecord(raw));
export const contact: LookupContact = { product: "consumer/1.0", email: "ops@example.org" };
export const provided = program.pipe(Effect.provide(biblioLookupLayer({ contact })));
export const clientLayer: Layer.Layer<BiblioLookup, never, HttpClient.HttpClient> =
  biblioLookupClientLayer({ contact });
export const direct = Option.map(doi, (proven) => lookupCrossrefByDoi(client, proven));
export const recovered = provided.pipe(
  Effect.catchTags({
    InvalidIdentifier: (error: InvalidIdentifier) => Effect.succeed(error.value),
    LookupFailed: (error: LookupFailed) => Effect.succeed(error.description),
    RefusedUrl: (error: RefusedUrl) => Effect.succeed(error.reason),
  }),
);

export const page = BiblioLookup.use((lookup) => lookup.byUrl("https://example.org/paper"));

/**
 * Every compile-time assertion, exported so `noUnusedLocals` keeps them and a
 * failing one names itself in the error.
 */
export type Checks = [
  /** _isbnIsBranded */ Assert<Not<Equals<Isbn, string>>>,
  /** _doiIsBranded */ Assert<Not<Equals<Doi, string>>>,
  /** _brandsAreDistinct */ Assert<Not<Equals<Isbn, Doi>>>,
  // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
  /** _identifierSlotIsBranded */ Assert<Equals<IdentifierSlot, Isbn | undefined>>,
  /** _itemTypeIsClosed */ Assert<Equals<Extract<CslItemType, "book">, "book">>,
  /** _pubMedAndArxivAreBranded */ Assert<Not<Equals<Pmid, string>>>,
  /** _pmidIsNotPmcid */ Assert<Not<Equals<Pmid, Pmcid>>>,
  /** _arxivIsBranded */ Assert<Not<Equals<Arxiv, string>>>,
  // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
  /** _pmidSlot */ Assert<Equals<BiblioRecord["identifiers"]["pmid"], Pmid | undefined>>,
  // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
  /** _pmcidSlot */ Assert<Equals<BiblioRecord["identifiers"]["pmcid"], Pmcid | undefined>>,
  // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
  /** _arxivSlot */ Assert<Equals<BiblioRecord["identifiers"]["arxiv"], Arxiv | undefined>>,
  // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
  /** _citationKey */ Assert<Equals<BiblioRecord["citation-key"], string | undefined>>,
  // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
  /** _itemId */ Assert<Equals<BiblioRecord["id"], string | number | undefined>>,
  // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
  /** _standardVariable */ Assert<Equals<BiblioRecord["archive_location"], string | undefined>>,
  /** _nameVariable */ Assert<
    // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
    Equals<BiblioRecord["executive-producer"], readonly CslName[] | undefined>
  >,
  // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
  /** _dateVariable */ Assert<Equals<BiblioRecord["available-date"], CslDate | undefined>>,
  /** _categories */ Assert<
    // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the record's own optional-key wire shape
    Equals<BiblioRecord["categories"], readonly string[] | undefined>
  >,
  /** _outcomeIsTagged */ Assert<Equals<ParseOutcome["outcome"], "parsed" | "skipped">>,
  // oxlint-disable-next-line effect/prefer-option-over-null -- asserts the outcome's own optional-key shape
  /** _outcomePosition */ Assert<Equals<ParseOutcome["position"], SourcePosition | undefined>>,
  /** _skipReasons */ Assert<
    Equals<SkipReason, "no-identifier" | "no-title" | "malformed" | "too-large" | "truncated">
  >,
  /** _parseModes */ Assert<Equals<ParseMode, "import" | "lenient">>,
  /** _parseOptionsAreLimits */ Assert<
    Equals<keyof RecordLimits & keyof ParseOptions, keyof RecordLimits>
  >,
  /** _parseTakesOptions */ Assert<
    // oxlint-disable-next-line effect/prefer-option-over-null -- asserts an optional parameter's shape
    Equals<Parameters<typeof parseBibliographicFile>[2], ParseOptions | undefined>
  >,
  /** _bestKeepsTheCandidateType */ Assert<Equals<NonNullable<typeof best>["id"], number>>,
  /** _bibliographyEntries */ Assert<
    Equals<(typeof bibliography.entries)[number]["label"], Option.Option<string>>
  >,
  /** _programRequiresTheService */ Assert<Equals<Effect.Services<typeof program>, BiblioLookup>>,
  /** _programFailsOnTheTypedChannel */ Assert<Equals<Effect.Error<typeof program>, LookupError>>,
  /** _programSucceedsWithARecord */ Assert<
    Equals<Effect.Success<typeof program>, Option.Option<BiblioRecord>>
  >,
  /** _productionLayerIsSelfContained */ Assert<Equals<Effect.Services<typeof provided>, never>>,
  /** _contactIsRequired */ Assert<
    Equals<Parameters<typeof biblioLookupLayer>, [options: BiblioLookupOptions]>
  >,
  /** _clientContactIsRequired */ Assert<
    Equals<Parameters<typeof biblioLookupClientLayer>, [options: BiblioLookupOptions]>
  >,
  /** _contactShape */ Assert<Equals<BiblioLookupOptions["contact"], LookupContact>>,
  /** _contactFields */ Assert<
    Equals<LookupContact, { readonly product: string; readonly email: string }>
  >,
  /** _errorTags */ Assert<
    Equals<LookupError["_tag"], "InvalidIdentifier" | "LookupFailed" | "RefusedUrl">
  >,
  /** _pageSucceedsWithEmbeddedMetadata */ Assert<
    Equals<Effect.Success<typeof page>, Option.Option<EmbeddedMetadata>>
  >,
  /** _pageFailsOnTheTypedChannel */ Assert<Equals<Effect.Error<typeof page>, LookupError>>,
  /** _resolverIsOptional */ Assert<
    // oxlint-disable-next-line effect/prefer-option-over-null -- asserts an optional option's shape
    Equals<BiblioLookupOptions["resolveAddresses"], ResolveAddresses | undefined>
  >,
  /** _recoveredNeverFails */ Assert<Equals<Effect.Error<typeof recovered>, never>>,
];
